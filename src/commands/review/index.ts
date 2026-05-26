import { defineCommand } from "citty";
import { parseActionId } from "~/utils/action-id.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { DispatchRoute } from "~/utils/enums.js";
import { enumName } from "~/utils/enums.js";
import type { AgentAction } from "~/module_bindings/types.js";
import {
  assertGithubArtifactKind,
  normalizeArtifactKind,
  parseGithubArtifactUrl,
  verifyGithubArtifactUrl,
} from "~/utils/github-artifact.js";
import { loadUserConfig } from "~/utils/user-config.js";

const SUBSCRIBE = ["SELECT * FROM agents", "SELECT * FROM agent_actions"];

async function validateArtifactUrl(url: string, kind: string, verify: boolean): Promise<void> {
  const parsed = verify
    ? await verifyGithubArtifactUrl(url, (await loadUserConfig()).githubOrg)
    : parseGithubArtifactUrl(url);
  assertGithubArtifactKind(parsed, kind);
}

function verifyOwnership(
  actionId: bigint,
  ctx: {
    agents: { id: string; identity: { toHexString(): string } }[];
    identity?: { toHexString(): string };
    agentActions: AgentAction[];
  },
): AgentAction {
  const found = ctx.agentActions.find((a) => a.id === actionId);
  if (!found) error("ACTION_NOT_FOUND", `Action ${actionId} not found`);
  const own = ctx.agents.find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
  if (!own || found.agentId !== own.id) {
    error("NOT_OWNER", `Action ${actionId} does not belong to you`);
  }
  return found;
}

export const reviewCompleteCommand = defineCommand({
  meta: { name: "complete", description: "Complete a review_task action with artifact" },
  args: {
    id: { type: "positional", description: "Action ID", required: true },
    outcome: { type: "string", description: "approved or changes-requested", required: true },
    summary: { type: "string", description: "Review summary", required: true },
    "artifact-kind": { type: "string", default: "review" },
    "artifact-url": { type: "string", required: true },
    "artifact-metadata": { type: "string" },
    verify: { type: "boolean", default: false },
    wallet: { type: "string" },
    host: { type: "string" },
    module: { type: "string" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);
    const outcome = String(args.outcome);
    if (!["approved", "changes-requested"].includes(outcome)) {
      error("INVALID_OUTCOME", "outcome must be approved or changes-requested");
    }
    const artifactKind = normalizeArtifactKind(String(args["artifact-kind"] || "review"));
    const artifactUrl = String(args["artifact-url"]);
    await validateArtifactUrl(artifactUrl, artifactKind, !!args.verify);

    await runReducerCommand(args, {
      subscribe: SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.completeReviewAction,
      params: (ctx) => {
        const owned = verifyOwnership(actionId, ctx);
        if (!DispatchRoute.is.reviewTask(owned.route)) {
          error("WRONG_ROUTE", `Action ${actionId} route is ${enumName(owned.route)}`);
        }
        return {
          actionId,
          outcome: { tag: outcome === "approved" ? "Approved" : "ChangesRequested" } as const,
          summary: String(args.summary),
          artifactKind,
          artifactUrl,
          artifactMetadata: args["artifact-metadata"] ?? undefined,
        };
      },
    });
    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export const reviewValidateCommand = defineCommand({
  meta: { name: "validate", description: "Complete a validate_review action with artifact" },
  args: {
    id: { type: "positional", description: "Action ID", required: true },
    outcome: { type: "string", description: "valid or invalid", required: true },
    summary: { type: "string", description: "Validation summary", required: true },
    "artifact-kind": { type: "string", default: "review_comment" },
    "artifact-url": { type: "string", required: true },
    "artifact-metadata": { type: "string" },
    verify: { type: "boolean", default: false },
    wallet: { type: "string" },
    host: { type: "string" },
    module: { type: "string" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args.id);
    const outcome = String(args.outcome);
    if (!["valid", "invalid"].includes(outcome)) {
      error("INVALID_OUTCOME", "outcome must be valid or invalid");
    }
    const artifactKind = normalizeArtifactKind(String(args["artifact-kind"] || "review_comment"));
    const artifactUrl = String(args["artifact-url"]);
    await validateArtifactUrl(artifactUrl, artifactKind, !!args.verify);

    await runReducerCommand(args, {
      subscribe: SUBSCRIBE,
      reducer: (ctx) => ctx.conn.reducers.completeValidateReviewAction,
      params: (ctx) => {
        const owned = verifyOwnership(actionId, ctx);
        if (!DispatchRoute.is.validateReview(owned.route)) {
          error("WRONG_ROUTE", `Action ${actionId} route is ${enumName(owned.route)}`);
        }
        return {
          actionId,
          outcome: { tag: outcome === "valid" ? "Valid" : "Invalid" } as const,
          summary: String(args.summary),
          artifactKind,
          artifactUrl,
          artifactMetadata: args["artifact-metadata"] ?? undefined,
        };
      },
    });
    success({ action_id: actionId.toString(), status: "completed" });
  },
});

export default defineSubcommandParent({
  name: "review",
  description: "Complete review and validation actions with artifacts",
  help: {
    command: "probe review",
    description: "Complete review and validation actions with artifacts",
    usage: [
      "probe review <subcommand> [args]",
      "probe review complete 42 --outcome approved --summary ... --artifact-url ...",
    ],
    actions: [
      { name: "complete <id>", detail: "Complete a review action" },
      { name: "validate <id>", detail: "Complete a validation action" },
    ],
  },
  subCommands: {
    complete: reviewCompleteCommand,
    validate: reviewValidateCommand,
  },
});
