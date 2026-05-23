import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { ProjectStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "status", description: "Show only project status" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM projects"] }),
      );
      const project = ctx.projects.find((p) => p.id.toString() === args.id);
      if (!project) error("PROJECT_NOT_FOUND", `Project not found: ${args.id}`);

      const status = ProjectStatus.display(project.status);
      success({ projectId: args.id, status });
    });
  },
});
