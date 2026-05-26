import { defineCommand } from "citty";
import {
  type AgentAction,
  type CommandContext,
  commandContextOptions,
  withAuth,
} from "~/utils/context.js";
import { DispatchRoute, enumName, identityHex } from "~/utils/enums.js";
import { parseActionId } from "~/utils/action-id.js";
import { completionGuideForAction } from "~/utils/action-completion.js";
import { loadUserConfig } from "~/utils/user-config.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

const ACTION_SUBSCRIBE = [
  "SELECT * FROM agents",
  "SELECT * FROM agent_actions",
  "SELECT * FROM tasks",
  "SELECT * FROM projects",
  "SELECT * FROM dispatch_route_config",
  "SELECT * FROM applied_genesis",
];

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

function targetRepoForAction(ctx: CommandContext, action: AgentAction): string | undefined {
  if (action.targetType !== "task" || !action.targetId) return undefined;
  const taskId = BigInt(action.targetId);
  const task = ctx.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  const project = ctx.projects.find((p) => p.id === task.projectId);
  return project?.githubRepo;
}

function formatActionRow(
  ctx: CommandContext,
  action: AgentAction,
  extras?: { githubOrg?: string },
): Record<string, unknown> {
  const routeTag = enumName(action.route);
  const routeConfig = ctx.dispatchRouteConfig.find((r) => enumName(r.route) === routeTag);
  return {
    id: action.id.toString(),
    kind: enumName(action.kind),
    route: routeTag,
    capability: routeConfig?.capability ?? "—",
    skill: action.skill,
    instruction: action.instruction,
    target_type: action.targetType ?? "—",
    target_id: action.targetId ?? "—",
    target_repo: targetRepoForAction(ctx, action) ?? "—",
    "org.github_org": extras?.githubOrg ?? "—",
    result_idea_id: action.resultIdeaId?.toString() ?? "—",
    result_vote_id: action.resultVoteId?.toString() ?? "—",
    reason_code: action.reasonCode,
    trigger_type: action.triggerType,
    trigger_id: action.triggerId ?? "—",
    status: enumName(action.status),
    created_at: action.createdAt,
    updated_at: action.updatedAt,
    run_outcome: enumName(action.runOutcome),
    harness: action.harness ?? "—",
    completion: completionGuideForAction(action),
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

function completionHintForAction(action: AgentAction): string {
  const route = action.route;
  const id = action.id.toString();
  if (DispatchRoute.is.reviewTask(route)) {
    return `Use: probe review complete ${id} --outcome approved|changes-requested --summary "..." --artifact-kind review --artifact-url <url>`;
  }
  if (DispatchRoute.is.validateReview(route)) {
    return `Use: probe review validate ${id} --outcome valid|invalid --summary "..." --artifact-kind review_comment --artifact-url <url>`;
  }
  return `Use: probe action complete ${id}`;
}

function blockGenericCompleteOnReviewRoutes(action: AgentAction): void {
  if (DispatchRoute.is.reviewTask(action.route)) {
    error(
      "WRONG_ROUTE",
      `Action ${action.id} is a peer review (ReviewTask).`,
      completionHintForAction(action),
    );
  }
  if (DispatchRoute.is.validateReview(action.route)) {
    error(
      "WRONG_ROUTE",
      `Action ${action.id} is a review validation (ValidateReview).`,
      completionHintForAction(action),
    );
  }
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

        const local = await loadUserConfig();
        const applied = ctx.appliedGenesis.find((r) => r.id === "active");
        const contextCommands = buildContextCommands(action);
        const row = formatActionRow(ctx, action, {
          githubOrg: applied?.githubOrg ?? local.githubOrg,
        });

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

export default defineSubcommandParent({
  name: "action",
  description: "Manage action lifecycle — show, complete, fail, skip",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  help: {
    command: "probe action",
    description: "Action lifecycle: show, complete, fail, skip",
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
    ],
  },
  subCommands: {
    show: actionShowCommand,
    complete: actionCompleteCommand,
    fail: actionFailCommand,
    skip: actionSkipCommand,
  },
});
