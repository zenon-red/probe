import { defineCommand } from "citty";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { TaskStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

export const taskUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update task status and optional PR URL" },
  args: {
    id: { type: "positional", description: "Task ID", required: true },
    status: { type: "string", description: "New status" },
    "github-pr-url": { type: "string", description: "GitHub PR URL" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (!args.status && !args["github-pr-url"]) {
      error("UPDATE_REQUIRED", "--status or --github-pr-url required");
    }

    try {
      await withAuth(commandContextOptions(args, { subscribe: [] }), async (ctx) => {
        await callReducer(ctx, ctx.conn.reducers.updateTaskStatus, {
          taskId: BigInt(args.id),
          status: args.status ? TaskStatus.fromString(args.status) : (undefined as never),
          githubPrUrl: args["github-pr-url"],
          archiveReason: undefined,
        });
      });
      success({
        updated: true,
        taskId: args.id,
        status: args.status,
        pr: args["github-pr-url"],
      });
    } catch (err) {
      error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
    }
  },
});
