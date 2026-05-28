import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "submit-plan", description: "Submit a project plan for human review" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    path: {
      type: "string",
      description: "Path to plan file in repo (e.g. docs/plan.md)",
      required: true,
    },
    commit: { type: "string", description: "Git commit SHA containing the plan", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.submitProjectPlanRef,
        params: {
          projectId: BigInt(args.id as string),
          planRefPath: args.path as string,
          planRefCommit: args.commit as string,
        },
      });
      success({
        submitted: true,
        projectId: args.id,
        planRefPath: args.path,
        planRefCommit: args.commit,
      });
    });
  },
});
