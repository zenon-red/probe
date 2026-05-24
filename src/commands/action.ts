import { defineCommand } from "citty";
import {
  type AgentAction,
  type CommandContext,
  commandContextOptions,
  withAuth,
} from "~/utils/context.js";
import type { DispatchRoute as DispatchRouteType } from "~/module_bindings/types.js";
import { DispatchRoute, enumName, identityHex } from "~/utils/enums.js";
import { parseActionId } from "~/utils/action-id.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

const ACTION_SUBSCRIBE = ["SELECT * FROM agents", "SELECT * FROM agent_actions"];

function buildContextCommands(action: AgentAction): string[] {
  const commands: string[] = [];
  if (action.targetType === "idea" && action.targetId) {
    commands.push(`probe idea get ${action.targetId}`);
    commands.push("probe idea dimensions");
  }
  if (action.targetType === "task" && action.targetId) {
    commands.push(`probe task get ${action.targetId}`);
  }
  if (action.targetType === "project" && action.targetId) {
    commands.push(`probe project get ${action.targetId}`);
  }
  return commands;
}

function formatActionRow(action: AgentAction): Record<string, unknown> {
  return {
    id: action.id.toString(),
    kind: enumName(action.kind),
    route: enumName(action.route),
    skill: action.skill,
    instruction: action.instruction,
    target_type: action.targetType ?? "—",
    target_id: action.targetId ?? "—",
    reason_code: action.reasonCode,
    trigger_type: action.triggerType,
    trigger_id: action.triggerId ?? "—",
    status: enumName(action.status),
    created_at: action.createdAt,
    updated_at: action.updatedAt,
    run_outcome: enumName(action.runOutcome),
    harness: action.harness ?? "—",
  };
}

function findAction(ctx: CommandContext, actionId: bigint): AgentAction | undefined {
  return ctx.agentActions.find((a) => a.id === actionId);
}

function verifyOwnership(ctx: CommandContext, actionId: bigint): AgentAction {
  const action = findAction(ctx, actionId);

  if (!action) {
    error("ACTION_NOT_FOUND", `Action ${actionId} not found.`);
  }

  const ownAgent = ctx.agents.find(
    (agent) => identityHex(agent.identity) === identityHex(ctx.auth?.identity),
  );

  if (!ownAgent || action.agentId !== ownAgent.id) {
    error("NOT_OWNER", `Action ${actionId} does not belong to you.`);
  }

  return action;
}

function completionHintForRoute(route: DispatchRouteType, actionId: bigint): string {
  const id = actionId.toString();
  if (DispatchRoute.is.reviewTask(route)) {
    return `Use: probe action review ${id} --outcome approved|changes-requested --summary "..."`;
  }
  if (DispatchRoute.is.validateReview(route)) {
    return `Use: probe action validate-review ${id} --outcome valid|invalid --summary "..."`;
  }
  return `Use: probe action complete ${id}`;
}

function blockGenericCompleteOnReviewRoutes(action: AgentAction): void {
  if (DispatchRoute.is.reviewTask(action.route)) {
    error(
      "WRONG_ROUTE",
      `Action ${action.id} is a peer review (ReviewTask).`,
      completionHintForRoute(action.route, action.id),
    );
  }
  if (DispatchRoute.is.validateReview(action.route)) {
    error(
      "WRONG_ROUTE",
      `Action ${action.id} is a review validation (ValidateReview).`,
      completionHintForRoute(action.route, action.id),
    );
  }
}

function requireReviewTaskRoute(action: AgentAction): void {
  if (DispatchRoute.is.reviewTask(action.route)) return;
  error(
    "WRONG_ROUTE",
    `Action ${action.id} has route ${enumName(action.route)}, not ReviewTask.`,
    completionHintForRoute(action.route, action.id),
  );
}

function requireValidateReviewRoute(action: AgentAction): void {
  if (DispatchRoute.is.validateReview(action.route)) return;
  error(
    "WRONG_ROUTE",
    `Action ${action.id} has route ${enumName(action.route)}, not ValidateReview.`,
    completionHintForRoute(action.route, action.id),
  );
}

type ActionConnectionArgs = {
  wallet?: string;
  host?: string;
  module?: string;
};

export const actionShowCommand = defineCommand({
  meta: { name: "show", description: "Show details of an action" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    await withAuth(
      commandContextOptions(args as ActionConnectionArgs, { subscribe: ACTION_SUBSCRIBE }),
      async (ctx) => {
        const action = findAction(ctx, actionId);

        if (!action) {
          error("ACTION_NOT_FOUND", `Action ${actionId} not found.`);
        }

        const contextCommands = buildContextCommands(action);
        const row = formatActionRow(action);

        success({ action: row }, contextCommands);
      },
    );
  },
});

export const actionCompleteCommand = defineCommand({
  meta: { name: "complete", description: "Mark an action as completed" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.updateAgentAction,
      params: (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        blockGenericCompleteOnReviewRoutes(action);
        return {
          actionId,
          eventType: { tag: "Completed" as const },
          eventCode: undefined,
          note: undefined,
        };
      },
    });

    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export const actionFailCommand = defineCommand({
  meta: { name: "fail", description: "Mark an action as failed" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    reason: { type: "string", description: "Failure reason", alias: "r", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.updateAgentAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return {
          actionId,
          eventType: { tag: "Failed" as const },
          eventCode: undefined,
          note: args.reason ?? undefined,
        };
      },
    });

    success({ action_id: actionId.toString(), status: "failed", reason: args.reason });
  },
});

export const actionSkipCommand = defineCommand({
  meta: { name: "skip", description: "Skip an action" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    reason: { type: "string", description: "Skip reason", alias: "r", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.updateAgentAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return {
          actionId,
          eventType: { tag: "Skipped" as const },
          eventCode: undefined,
          note: args.reason ?? undefined,
        };
      },
    });

    success({ action_id: actionId.toString(), status: "skipped", reason: args.reason });
  },
});

export const actionReviewCommand = defineCommand({
  meta: { name: "review", description: "Complete a ReviewTask action with outcome" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    outcome: {
      type: "string",
      description: "Review outcome: approved or changes-requested",
      required: true,
      alias: "o",
    },
    summary: {
      type: "string",
      description: "Review summary",
      required: true,
      alias: "s",
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    const validOutcomes = ["approved", "changes-requested"];
    if (!validOutcomes.includes(args.outcome)) {
      error("INVALID_OUTCOME", `Outcome must be one of: ${validOutcomes.join(", ")}`);
    }

    const outcomeTag =
      args.outcome === "approved" ? ("Approved" as const) : ("ChangesRequested" as const);

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.completeReviewAction,
      params: (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        requireReviewTaskRoute(action);
        return {
          actionId,
          outcome: { tag: outcomeTag },
          summary: args.summary,
        };
      },
    });

    success({ action_id: actionId.toString(), status: "completed", review_outcome: args.outcome });
  },
});

export const actionValidateReviewCommand = defineCommand({
  meta: { name: "validate-review", description: "Complete a ValidateReview action with outcome" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    outcome: {
      type: "string",
      description: "Validation outcome: valid or invalid",
      required: true,
      alias: "o",
    },
    summary: {
      type: "string",
      description: "Validation summary",
      required: true,
      alias: "s",
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);

    const validOutcomes = ["valid", "invalid"];
    if (!validOutcomes.includes(args.outcome)) {
      error("INVALID_OUTCOME", `Outcome must be one of: ${validOutcomes.join(", ")}`);
    }

    const outcomeTag = args.outcome === "valid" ? ("Valid" as const) : ("Invalid" as const);

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.completeValidateReviewAction,
      params: (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        requireValidateReviewRoute(action);
        return {
          actionId,
          outcome: { tag: outcomeTag },
          summary: args.summary,
        };
      },
    });

    success({
      action_id: actionId.toString(),
      status: "completed",
      validation_outcome: args.outcome,
    });
  },
});

export default defineSubcommandParent({
  name: "action",
  description: "Manage action lifecycle — show, complete, fail, skip, review, validate-review",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  help: {
    command: "probe action",
    description: "Action lifecycle: show, complete, fail, skip, review, validate-review",
    usage: [
      "probe action <subcommand> [positionals] [args]",
      "probe action show 42",
      "probe action complete 42",
    ],
    actions: [
      { name: "show <id>", detail: "Show one action" },
      { name: "complete <id>", detail: "Mark an action completed" },
      { name: "fail <id>", detail: "Mark an action failed" },
      { name: "skip <id>", detail: "Skip an action" },
      { name: "review <id>", detail: "Complete a review action" },
      { name: "validate-review <id>", detail: "Complete a review validation action" },
    ],
  },
  subCommands: {
    show: actionShowCommand,
    complete: actionCompleteCommand,
    fail: actionFailCommand,
    skip: actionSkipCommand,
    review: actionReviewCommand,
    "validate-review": actionValidateReviewCommand,
  },
});
