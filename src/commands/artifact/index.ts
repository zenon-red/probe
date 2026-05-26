import { defineCommand } from "citty";
import { parseActionId } from "~/utils/action-id.js";
import { commandContextOptions, withAuth, callReducer } from "~/utils/context.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import {
  assertGithubArtifactKind,
  normalizeArtifactKind,
  parseGithubArtifactUrl,
  verifyGithubArtifactUrl,
} from "~/utils/github-artifact.js";
import { loadUserConfig } from "~/utils/user-config.js";

const SUBSCRIBE = ["SELECT * FROM agents", "SELECT * FROM agent_actions", "SELECT * FROM artifact"];

const registerCommand = defineCommand({
  meta: { name: "register", description: "Register a GitHub artifact for an action" },
  args: {
    "action-id": { type: "string", description: "Action ID", required: true },
    kind: {
      type: "string",
      description: "Artifact kind (pull_request, review, ...)",
      required: true,
    },
    url: { type: "string", description: "GitHub artifact URL", required: true },
    summary: { type: "string", description: "Short summary", required: true },
    "head-branch": { type: "string", description: "Optional head branch" },
    "base-branch": { type: "string", description: "Optional base branch" },
    title: { type: "string", description: "Optional title" },
    verify: { type: "boolean", description: "Verify URL via gh", default: false },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args["action-id"]);
    const kind = normalizeArtifactKind(String(args.kind));
    const url = String(args.url || "").trim();
    const summary = String(args.summary || "").trim();
    if (!summary) error("ARGS_REQUIRED", "summary required");

    const local = await loadUserConfig();
    const parsed = args.verify
      ? await verifyGithubArtifactUrl(url, local.githubOrg)
      : parseGithubArtifactUrl(url);
    assertGithubArtifactKind(parsed, kind);

    await withAuth(commandContextOptions(args, { subscribe: SUBSCRIBE }), async (ctx) => {
      await callReducer(ctx, ctx.conn.reducers.registerArtifact, {
        actionId,
        kind,
        url,
        summary,
        headBranch: args["head-branch"] ?? undefined,
        baseBranch: args["base-branch"] ?? undefined,
        title: args.title ?? undefined,
      });
      success({ action_id: actionId.toString(), kind, url, registered: true });
    });
  },
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List artifacts for an action" },
  args: {
    "action-id": { type: "string", description: "Action ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const actionId = parseActionId(args["action-id"]);
    await withAuth(commandContextOptions(args, { subscribe: SUBSCRIBE }), async (ctx) => {
      const rows = ctx.artifacts
        .filter((a) => a.actionId === actionId)
        .map((a) => ({
          id: a.id.toString(),
          kind: a.kind,
          url: a.url,
          repo: a.repo,
          summary: a.summary,
        }));
      success({ action_id: actionId.toString(), artifacts: rows });
    });
  },
});

export default defineSubcommandParent({
  name: "artifact",
  description: "Register and list action artifacts",
  help: {
    command: "probe artifact",
    description: "Register and list action artifacts",
    usage: [
      "probe artifact <subcommand> [args]",
      "probe artifact register --action-id 42 --kind pull_request --url ... --summary ...",
    ],
    actions: [
      { name: "register", detail: "Register a GitHub artifact for an action" },
      { name: "list", detail: "List artifacts for an action" },
    ],
  },
  subCommands: {
    register: registerCommand,
    list: listCommand,
  },
});
