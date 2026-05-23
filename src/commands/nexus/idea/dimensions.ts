import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "dimensions", description: "List active evaluation dimensions" },
  args: {
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM evaluation_dimensions"] }),
      );
      const dimensions = ctx.evaluationDimensions
        .filter((dimension) => dimension.active)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      success({ dimensions, count: dimensions.length });
    });
  },
});
