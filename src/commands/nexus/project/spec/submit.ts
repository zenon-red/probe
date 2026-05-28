import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "../shared.js";

export default defineCommand({
  meta: { name: "submit", description: "Submit a project spec for human review" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    path: {
      type: "string",
      description: "Path to spec file in repo (e.g. openspec/changes/foo/specs/bar/spec.md)",
      required: true,
    },
    commit: { type: "string", description: "Git commit SHA containing the spec", required: true },
    hash: {
      type: "string",
      description: "SHA-256 content hash of the gating spec file",
      required: true,
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.submitProjectSpecRef,
        params: {
          projectId: BigInt(args.id as string),
          specRefPath: args.path as string,
          specRefCommit: args.commit as string,
          specContentHash: args.hash as string,
        },
      });
      success({
        submitted: true,
        projectId: args.id,
        specRefPath: args.path,
        specRefCommit: args.commit,
        specContentHash: args.hash,
      });
    });
  },
});
