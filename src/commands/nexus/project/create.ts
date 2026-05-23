import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "create", description: "Create a new project" },
  args: {
    name: { type: "string", description: "Project name", required: true },
    "github-repo": { type: "string", description: "GitHub repository URL", required: true },
    "source-idea": { type: "string", description: "Source idea ID", required: true },
    description: { type: "string", description: "Project description" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.createProject,
        params: {
          sourceIdeaId: BigInt(args["source-idea"] as string),
          name: args.name!,
          githubRepo: args["github-repo"]!,
          description: args.description || "",
        },
      });
      success({
        created: true,
        name: args.name,
        githubRepo: args["github-repo"],
        sourceIdeaId: args["source-idea"],
        hint: "Plan ref must be submitted and approved by human reviewer before tasks can be created",
      });
    });
  },
});
