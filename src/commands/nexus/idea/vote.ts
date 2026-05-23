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
    ...voteScoreArgs,
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const dimensionScores = buildDimensionScores(args);

    await runWithBoundary(async () => {
      try {
        await withAuth(
          commandContextOptions(args, {
            subscribe: ["SELECT * FROM evaluation_dimensions"],
          }),
          async (ctx) => {
            validateDimensionScores(dimensionScores, ctx.evaluationDimensions);

            await callReducer(ctx, ctx.conn.reducers.voteIdea, {
              ideaId: BigInt(args.id),
              scores: dimensionScores,
            });
          },
        );
        success({ voted: true, ideaId: args.id, scores: dimensionScores });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
