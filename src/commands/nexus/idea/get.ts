import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "get", description: "Show one idea by ID" },
  args: {
    id: { type: "positional", name: "id", description: "Idea ID", required: true },
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
      const idea = ctx.ideas.find((i) => i.id.toString() === args.id);
      if (!idea) error("IDEA_NOT_FOUND", `Idea not found: ${args.id}`);

      success(idea);
    });
  },
});
