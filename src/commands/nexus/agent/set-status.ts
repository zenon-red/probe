import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { AgentStatus } from "~/utils/enums.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: {
    name: "set-status",
    description: "Update current agent status (online, offline, working, busy)",
  },
  args: {
    status: {
      type: "positional",
      name: "status",
      description: "Status: online, offline, working, busy",
      required: true,
    },
    task: { type: "string", description: "Task ID (required when status is working)" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const nextStatus = args.status;
    const normalized = nextStatus.toLowerCase();
    const allowed = new Set(["online", "offline", "working", "busy"]);
    if (!allowed.has(normalized)) {
      error("INVALID_STATUS", `Invalid status: ${nextStatus}. Use: online, offline, working, busy`);
    }

    const mapped = AgentStatus.fromString(normalized);
    const isWorking = AgentStatus.is.working(mapped);
    if (isWorking && !args.task) {
      error("TASK_REQUIRED", "--task is required when setting status to working");
    }
    if (!isWorking && args.task) {
      error("TASK_NOT_ALLOWED", "--task is only allowed when setting status to working");
    }

    await runWithBoundary(async () => {
      try {
        await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.setAgentStatus, {
            status: mapped,
            taskId: isWorking ? BigInt(args.task as string) : undefined,
          });
        });

        success({
          updated: true,
          status: normalized,
          taskId: args.task || null,
        });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
