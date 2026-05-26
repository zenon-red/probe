import { defineCommand } from "citty";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import {
  buildDimensionScores,
  runWithBoundary,
  validateDimensionScores,
  voteScoreArgs,
} from "./shared.js";

export default defineCommand({
  meta: { name: "vote", description: "Vote on an idea with dimension scores" },
  args: {
    id: { type: "positional", name: "id", description: "Idea ID", required: true },
    "action-id": { type: "string", description: "Dispatch action ID (vote route)" },
    ...voteScoreArgs,
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const dimensionScores = buildDimensionScores(args);

    const actionIdRaw = args["action-id"] ? String(args["action-id"]).trim() : "";

    await runWithBoundary(async () => {
      try {
        await withAuth(
          commandContextOptions(args, {
            subscribe: ["SELECT * FROM evaluation_dimensions", "SELECT * FROM agent_actions"],
          }),
          async (ctx) => {
            validateDimensionScores(dimensionScores, ctx.evaluationDimensions);

            if (actionIdRaw) {
              const { parseActionId } = await import("~/utils/action-id.js");
              const actionId = parseActionId(actionIdRaw);
              await callReducer(ctx, ctx.conn.reducers.voteIdeaForAction, {
                actionId,
                scores: dimensionScores,
              });
              success({
                voted: true,
                action_id: actionId.toString(),
                ideaId: args.id,
                scores: dimensionScores,
              });
              return;
            }

            await callReducer(ctx, ctx.conn.reducers.voteIdea, {
              ideaId: BigInt(args.id),
              scores: dimensionScores,
            });
          },
        );
        if (!actionIdRaw) {
          success({ voted: true, ideaId: args.id, scores: dimensionScores });
        }
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
