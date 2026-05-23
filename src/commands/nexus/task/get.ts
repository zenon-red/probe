import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "../discover/shared.js";

export const taskGetCommand = defineCommand({
  meta: { name: "get", description: "Show one task" },
  args: {
    id: { type: "positional", description: "Task ID", required: true },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM tasks"] }),
      );
      const task = ctx.tasks.find((t) => t.id.toString() === args.id);
      if (!task) error("TASK_NOT_FOUND", `Task not found: ${args.id}`);

      success(task);
    });
  },
});
