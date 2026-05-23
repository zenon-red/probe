// TODO: add unit tests for ownership verification and reducer error paths
import { defineCommand } from "citty";
import { callReducer, withAuth } from "~/utils/context.js";
import type { DispatchRoute as DispatchRouteType } from "~/module_bindings/types.js";
import { DispatchRoute, enumName, identityHex } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

/**
 * Action row shape including new central dispatch fields.
 *
 * NOTE: This file assumes the Nexus SpacetimeDB module has been upgraded to
 * the central-dispatch schema. Reducers like `complete_review_action` and
 * `complete_validate_review_action` will throw if the deployed module is
 * older. Upgrade the module and the CLI together.
 */
interface ActionRow {
  id: number;
  agentId: string;
  kind: unknown;
  targetType?: string | null;
  targetId?: string | null;
  reasonCode: string;
  status: unknown;
  createdAt: string;
  updatedAt: string;
  skill?: string;
  instruction?: string;
  triggerType?: string;
  triggerId?: string;
  route?: DispatchRouteType;
  runOutcome?: unknown;
  harness?: string;
}

interface AgentRow {
  id: string;
  identity: unknown;
}

function getActionRows(ctx: { db: unknown }): ActionRow[] {
  const db = ctx.db as Record<string, { iter?: () => IterableIterator<Record<string, unknown>> }>;
  const table = db["agent_actions"];
  if (!table?.iter) return [];
  return Array.from(table.iter()) as unknown as ActionRow[];
}

function getAgentRows(ctx: { db: unknown }): AgentRow[] {
  const db = ctx.db as Record<string, { iter?: () => IterableIterator<Record<string, unknown>> }>;
  const table = db["agents"];
  if (!table?.iter) return [];
  return Array.from(table.iter()) as unknown as AgentRow[];
}

function buildContextCommands(action: ActionRow): string[] {
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

function formatActionRow(action: ActionRow): Record<string, unknown> {
  return {
    id: action.id,
    kind: enumName(action.kind),
    route: enumName(action.route),
    skill: action.skill ?? "—",
    instruction: action.instruction ?? "—",
    target_type: action.targetType ?? "—",
    target_id: action.targetId ?? "—",
    reason_code: action.reasonCode,
    trigger_type: action.triggerType ?? "—",
    trigger_id: action.triggerId ?? "—",
    status: enumName(action.status),
    created_at: action.createdAt,
    updated_at: action.updatedAt,
    run_outcome: enumName(action.runOutcome),
    harness: action.harness ?? "—",
  };
}

function verifyOwnership(
  ctx: { db: unknown; auth?: { identity: unknown } },
  actionId: number,
): ActionRow {
  const actions = getActionRows(ctx);
  const action = actions.find((a) => a.id === actionId);

  if (!action) {
    error("ACTION_NOT_FOUND", `Action ${actionId} not found.`);
  }

  const ownAgent = getAgentRows(ctx).find(
    (agent) => identityHex(agent.identity) === identityHex(ctx.auth?.identity),
  );

  if (!ownAgent || action.agentId !== ownAgent.id) {
    error("NOT_OWNER", `Action ${actionId} does not belong to you.`);
  }

  return action;
}

function completionHintForRoute(route: DispatchRouteType | undefined, actionId: number): string {
  if (DispatchRoute.is.reviewTask(route)) {
    return `Use: probe action review ${actionId} --outcome approved|changes-requested --summary "..."`;
  }
  if (DispatchRoute.is.validateReview(route)) {
    return `Use: probe action validate-review ${actionId} --outcome valid|invalid --summary "..."`;
  }
  return `Use: probe action complete ${actionId}`;
}

function blockGenericCompleteOnReviewRoutes(action: ActionRow): void {
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

function requireReviewTaskRoute(action: ActionRow): void {
  if (DispatchRoute.is.reviewTask(action.route)) return;
  error(
    "WRONG_ROUTE",
    `Action ${action.id} has route ${enumName(action.route)}, not ReviewTask.`,
    completionHintForRoute(action.route, action.id),
  );
}

function requireValidateReviewRoute(action: ActionRow): void {
  if (DispatchRoute.is.validateReview(action.route)) return;
  error(
    "WRONG_ROUTE",
    `Action ${action.id} has route ${enumName(action.route)}, not ValidateReview.`,
    completionHintForRoute(action.route, action.id),
  );
}

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
    const actionId = Number(args.id);

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        const actions = getActionRows(ctx);
        const action = actions.find((a) => a.id === actionId);

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
    const actionId = Number(args.id);

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        blockGenericCompleteOnReviewRoutes(action);

        await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
          actionId: BigInt(actionId),
          eventType: { tag: "Completed" },
          eventCode: undefined,
          note: undefined,
        });

        success({ action_id: actionId, status: "completed" });
      },
    );
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
    const actionId = Number(args.id);

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        verifyOwnership(ctx, actionId);

        await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
          actionId: BigInt(actionId),
          eventType: { tag: "Failed" },
          eventCode: undefined,
          note: args.reason ?? undefined,
        });

        success({ action_id: actionId, status: "failed", reason: args.reason });
      },
    );
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
    const actionId = Number(args.id);

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        verifyOwnership(ctx, actionId);

        await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
          actionId: BigInt(actionId),
          eventType: { tag: "Skipped" },
          eventCode: undefined,
          note: args.reason ?? undefined,
        });

        success({ action_id: actionId, status: "skipped", reason: args.reason });
      },
    );
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
    const actionId = Number(args.id);

    const validOutcomes = ["approved", "changes-requested"];
    if (!validOutcomes.includes(args.outcome)) {
      error("INVALID_OUTCOME", `Outcome must be one of: ${validOutcomes.join(", ")}`);
    }

    const outcomeTag = args.outcome === "approved" ? "Approved" : "ChangesRequested";

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        requireReviewTaskRoute(action);

        await callReducer(ctx, ctx.conn.reducers.completeReviewAction, {
          actionId: BigInt(actionId),
          outcome: { tag: outcomeTag },
          summary: args.summary,
        });

        success({ action_id: actionId, status: "completed", review_outcome: args.outcome });
      },
    );
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
    const actionId = Number(args.id);

    const validOutcomes = ["valid", "invalid"];
    if (!validOutcomes.includes(args.outcome)) {
      error("INVALID_OUTCOME", `Outcome must be one of: ${validOutcomes.join(", ")}`);
    }

    const outcomeTag = args.outcome === "valid" ? "Valid" : "Invalid";

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM agent_actions"],
      },
      async (ctx) => {
        const action = verifyOwnership(ctx, actionId);
        requireValidateReviewRoute(action);

        await callReducer(ctx, ctx.conn.reducers.completeValidateReviewAction, {
          actionId: BigInt(actionId),
          outcome: { tag: outcomeTag },
          summary: args.summary,
        });

        success({ action_id: actionId, status: "completed", validation_outcome: args.outcome });
      },
    );
  },
});

export default defineCommand({
  meta: {
    name: "action",
    description: "Manage action lifecycle — show, complete, fail, skip, review, validate-review",
  },
  subCommands: {
    show: actionShowCommand,
    complete: actionCompleteCommand,
    fail: actionFailCommand,
    skip: actionSkipCommand,
    review: actionReviewCommand,
    "validate-review": actionValidateReviewCommand,
  },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  run() {
    error(
      "SUBCOMMAND_REQUIRED",
      "Usage: probe action <show|complete|fail|skip|review|validate-review> [args]",
      "Run: probe action --help",
    );
  },
});
