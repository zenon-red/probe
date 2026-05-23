import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { discoveryStatusDisplay, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "list", description: "List discovered tasks" },
  args: {
    status: { type: "string", description: "Filter by status" },
    limit: { type: "string", description: "Max discovered tasks returned" },
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
      let discovered = ctx.discoveredTasks;
      const limit = args.limit ? parseInt(args.limit, 10) : undefined;

      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        error("INVALID_LIMIT", "--limit must be a positive integer");
      }

      if (args.status) {
        const filter = args.status.toLowerCase().replace(/[_\s]/g, "");
        discovered = discovered.filter(
          (d) => discoveryStatusDisplay(d.status).replace(/[_\s]/g, "") === filter,
        );
      }
      discovered = discovered.sort((a, b) => {
        const aMicros = toMicros(a.createdAt);
        const bMicros = toMicros(b.createdAt);
        if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
        if (a.id === b.id) return 0;
        return b.id > a.id ? 1 : -1;
      });
      if (limit !== undefined) discovered = discovered.slice(0, limit);

      success({ discoveredTasks: discovered, count: discovered.length });
    });
  },
});
