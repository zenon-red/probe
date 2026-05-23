import { defineCommand } from "citty";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

export const taskReviewCommand = defineCommand({
  meta: { name: "review", description: "Mark a task as ready for review" },
  args: {
    id: { type: "positional", description: "Task ID", required: true },
    "github-pr-url": { type: "string", description: "GitHub PR URL" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    try {
      await withAuth(commandContextOptions(args, { subscribe: [] }), async (ctx) => {
        await callReducer(ctx, ctx.conn.reducers.updateTaskStatus, {
          taskId: BigInt(args.id),
          status: { tag: "Review" },
          githubPrUrl: args["github-pr-url"],
          archiveReason: undefined,
        });
      });
      success({
        reviewed: true,
        taskId: args.id,
        status: "review",
        pr: args["github-pr-url"],
      });
    } catch (err) {
      error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
    }
  },
});
