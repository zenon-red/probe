import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { parseReviewDecision } from "../idea/shared.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "review-plan", description: "Review a project plan (human role)" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    decision: {
      type: "string",
      description: "approved | rejected | changes-requested",
      required: true,
    },
    "reason-code": { type: "string", description: "Short reason code" },
    comment: { type: "string", description: "Free-text explanation" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const decisionRaw = String(args.decision);
    const decision = parseReviewDecision(decisionRaw);

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.reviewProjectPlan,
        params: {
          projectId: BigInt(args.id as string),
          decision,
          reasonCode: String(args["reason-code"] || ""),
          comment: String(args.comment || ""),
        },
      });
      success({
        reviewed: true,
        projectId: args.id,
        decision: decisionRaw.toLowerCase().trim(),
      });
    });
  },
});
