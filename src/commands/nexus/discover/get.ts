import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "get", description: "Show one discovered task by ID" },
  args: {
    id: { type: "positional", name: "id", description: "Discovered task ID", required: true },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM discovered_tasks"] }),
      );
      const discovery = ctx.discoveredTasks.find((d) => d.id.toString() === args.id);
      if (!discovery) error("DISCOVERY_NOT_FOUND", `Discovery not found: ${args.id}`);

      success(discovery);
    });
  },
});
