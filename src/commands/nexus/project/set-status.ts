import { defineCommand } from "citty";
import { ProjectStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "set-status", description: "Update project status (admin/zoe)" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    status: {
      type: "positional",
      name: "status",
      description: "Status: active|paused",
      required: true,
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const normalized = args.status.toLowerCase().replace(/[_\s]/g, "");
    if (!["active", "paused"].includes(normalized)) {
      error("INVALID_STATUS", `Invalid status: ${args.status}. Use: active, paused`);
    }

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        subscribe: [],
        reducer: (ctx) => ctx.conn.reducers.updateProjectStatus,
        params: {
          projectId: BigInt(args.id),
          status: ProjectStatus.fromString(args.status),
        },
      });

      success({ updated: true, projectId: args.id, status: normalized });
    });
  },
});
