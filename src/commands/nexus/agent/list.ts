import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { AgentStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "list", description: "List online agents" },
  args: {
    limit: { type: "string", description: "Max agents returned" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM agents"] }),
      );
      const limit = args.limit ? parseInt(args.limit, 10) : undefined;
      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        error("INVALID_LIMIT", "--limit must be a positive integer");
      }

      let onlineAgents = ctx.agents.filter((a) => !AgentStatus.is.offline(a.status));
      onlineAgents = onlineAgents.sort((a, b) => {
        const aMicros = toMicros(a.lastHeartbeat || a.createdAt || a.lastActiveAt);
        const bMicros = toMicros(b.lastHeartbeat || b.createdAt || b.lastActiveAt);
        if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
        return b.id.localeCompare(a.id);
      });
      if (limit !== undefined) onlineAgents = onlineAgents.slice(0, limit);

      success({ agents: onlineAgents, count: onlineAgents.length });
    });
  },
});
