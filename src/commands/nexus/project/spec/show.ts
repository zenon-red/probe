import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { enumName } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "../shared.js";

export default defineCommand({
  meta: { name: "show", description: "Show project spec reference and review status" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
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

      success({
        projectId: project.id.toString(),
        specRefPath: project.specRefPath || undefined,
        specRefCommit: project.specRefCommit || undefined,
        specContentHash: project.specContentHash || undefined,
        specReviewStatus: enumName(project.specReviewStatus),
        approvedSpecRefCommit: project.approvedSpecRefCommit || undefined,
        approvedSpecContentHash: project.approvedSpecContentHash || undefined,
        specReviewedBy: project.specReviewedBy || undefined,
        specReviewedAt: project.specReviewedAt?.toString(),
      });
    });
  },
});
