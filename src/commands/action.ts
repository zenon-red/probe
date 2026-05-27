import { defineCommand } from "citty";
import {
  type AgentAction,
  type CommandContext,
  commandContextOptions,
  withAuth,
} from "~/utils/context.js";
import { completionGuideForAction, completionPolicyForRoute } from "~/utils/action-completion.js";
import { enumName, identityHex } from "~/utils/enums.js";
import { toDiscoveryDecision } from "~/commands/nexus/discover/shared.js";
import { parseActionId } from "~/utils/action-id.js";
import { currentAgentForIdentity } from "~/commands/nexus/agent/shared.js";
import { taskRepoContext } from "~/utils/nexus-paths.js";
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

export function buildContextCommands(action: AgentAction): string[] {
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
  if (action.targetType === "discovered_task" && action.targetId) {
    commands.push(`probe discover get ${action.targetId}`);
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
  extras?: { githubOrg?: string; agentId?: string },
): Record<string, unknown> {
  const routeTag = enumName(action.route);
  const routeConfig = ctx.dispatchRouteConfig.find((r) => enumName(r.route) === routeTag);
  const targetRepo = targetRepoForAction(ctx, action);
  const repoContext =
    targetRepo && extras?.agentId
      ? taskRepoContext({
          agentId: extras.agentId,
          githubRepo: targetRepo,
          taskId: action.targetType === "task" ? action.targetId : undefined,
        })
      : undefined;
  return {
    id: action.id.toString(),
    kind: enumName(action.kind),
    route: routeTag,
    capability: routeConfig?.capability ?? "—",
    skill: action.skill,
    instruction: action.instruction,
    target_type: action.targetType ?? "—",
    target_id: action.targetId ?? "—",
    target_repo: repoContext?.target_repo ?? targetRepo ?? "—",
    repo_owner: repoContext?.repo_owner ?? "—",
    repo_name: repoContext?.repo_name ?? "—",
    upstream_url: repoContext?.upstream_url ?? "—",
    fork_url: repoContext?.fork_url ?? "—",
    fork_path: repoContext?.fork_path ?? "—",
    branch_hint: repoContext?.branch_hint ?? "—",
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
  const guide = completionGuideForAction(action);
  return guide.note ? `Use: ${guide.command} (${guide.note})` : `Use: ${guide.command}`;
}

function blockGenericCompleteOnGatedRoutes(action: AgentAction): void {
  const route = enumName(action.route);
  if (completionPolicyForRoute(route).genericAllowed) return;

  error(
    "WRONG_ROUTE",
    `Action ${action.id} (${route}) cannot use generic completion.`,
    completionHintForAction(action),
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

        const local = await loadUserConfig();
        const applied = ctx.appliedGenesis.find((r) => r.id === "active");
        const ownAgent = currentAgentForIdentity(ctx);
        const contextCommands = buildContextCommands(action);
        const row = formatActionRow(ctx, action, {
          githubOrg: applied?.githubOrg ?? local.githubOrg,
          agentId: ownAgent?.id,
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
        blockGenericCompleteOnGatedRoutes(action);
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

export const actionCompleteSetupCommand = defineCommand({
  meta: { name: "complete-setup", description: "Complete a project_setup action" },
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
      reducer: (ctx) => ctx.conn.reducers.completeProjectSetupAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return { actionId };
      },
    });

    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export const actionCompleteTasksCommand = defineCommand({
  meta: { name: "complete-tasks", description: "Complete a create_tasks action" },
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
      reducer: (ctx) => ctx.conn.reducers.completeCreateTasksAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return { actionId };
      },
    });

    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export const actionCompleteMergeCommand = defineCommand({
  meta: { name: "complete-merge", description: "Complete a merge_ready_task action" },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    note: { type: "string", description: "Optional finalization note" },
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
      reducer: (ctx) => ctx.conn.reducers.completeMergeReadyAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return { actionId, note: args.note ?? undefined };
      },
    });

    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export const actionReviewDiscoveryCommand = defineCommand({
  meta: {
    name: "review-discovery",
    description: "Review a discovery and complete the review_discovery action",
  },
  args: {
    id: { type: "positional", name: "id", description: "Action ID", required: true },
    decision: {
      type: "positional",
      name: "decision",
      description: "approve, reject, or escalate_to_idea",
      required: true,
    },
    reason: { type: "string", description: "Reason for rejection/escalation" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);
    const decisionValue = toDiscoveryDecision(args.decision.toLowerCase());
    if (!decisionValue) {
      error(
        "INVALID_DECISION",
        `Invalid decision: ${args.decision}. Use: approve, reject, escalate_to_idea`,
      );
    }

    await runReducerCommand(args as ActionConnectionArgs, {
      subscribe: ACTION_SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.reviewDiscoveryForAction,
      params: (ctx) => {
        verifyOwnership(ctx, actionId);
        return {
          actionId,
          decision: decisionValue,
          reason: args.reason ?? undefined,
        };
      },
    });

    success({
      action_id: actionId.toString(),
      status: "completed",
      decision: args.decision.toLowerCase(),
    });
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
  description: "Manage action lifecycle",
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
      "probe action complete-setup 42",
      "probe action complete-tasks 42",
      "probe action complete-merge 42",
      "probe action review-discovery 42 approve|reject|escalate_to_idea",
    ],
    actions: [
      { name: "show <id>", detail: "Show one action" },
      { name: "complete <id>", detail: "Mark an action completed" },
      { name: "complete-setup <id>", detail: "Complete a project setup action" },
      { name: "complete-tasks <id>", detail: "Complete a create-tasks action" },
      { name: "complete-merge <id>", detail: "Complete a merge-ready action" },
      { name: "review-discovery <id> <decision>", detail: "Complete a discovery review" },
      { name: "fail <id>", detail: "Mark an action failed" },
      { name: "skip <id>", detail: "Skip an action" },
    ],
  },
  subCommands: {
    show: actionShowCommand,
    complete: actionCompleteCommand,
    "complete-setup": actionCompleteSetupCommand,
    "complete-tasks": actionCompleteTasksCommand,
    "complete-merge": actionCompleteMergeCommand,
    "review-discovery": actionReviewDiscoveryCommand,
    fail: actionFailCommand,
    skip: actionSkipCommand,
  },
});
