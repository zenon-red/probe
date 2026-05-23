import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { IdeaStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary, sortIdeasNewest } from "./shared.js";

export default defineCommand({
  meta: { name: "list", description: "List ideas with optional filters" },
  args: {
    status: { type: "string", description: "Filter by status" },
    category: { type: "string", description: "Filter by category" },
    limit: { type: "string", description: "Max ideas returned" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM ideas"] }),
      );
      let ideas = ctx.ideas;
      const limit = args.limit ? parseInt(args.limit, 10) : undefined;

      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        error("INVALID_LIMIT", "--limit must be a positive integer");
      }

      if (args.status) ideas = ideas.filter((i) => IdeaStatus.matches(i.status, args.status!));
      if (args.category) ideas = ideas.filter((i) => i.category === args.category);
      ideas = sortIdeasNewest(ideas);
      if (limit !== undefined) ideas = ideas.slice(0, limit);

      success({ ideas, count: ideas.length });
    });
  },
});
