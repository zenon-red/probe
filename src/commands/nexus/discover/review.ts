import { defineCommand } from "citty";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary, toDiscoveryDecision } from "./shared.js";

export default defineCommand({
  meta: {
    name: "review",
    description: "Approve, reject, or escalate a discovered task",
  },
  args: {
    id: { type: "positional", name: "id", description: "Discovered task ID", required: true },
    decision: {
      type: "positional",
      name: "decision",
      description: "Decision: approve, reject, escalate_to_idea",
      required: true,
    },
    reason: { type: "string", description: "Reason for rejection/escalation" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const decision = args.decision.toLowerCase();
    const validDecisions = ["approve", "reject", "escalate_to_idea"];
    if (!validDecisions.includes(decision)) {
      error(
        "INVALID_DECISION",
        `Invalid decision: ${args.decision}. Use: ${validDecisions.join(", ")}`,
      );
    }

    const decisionValue = toDiscoveryDecision(decision);
    if (!decisionValue) {
      error(
        "INVALID_DECISION",
        `Invalid decision: ${args.decision}. Use: ${validDecisions.join(", ")}`,
      );
    }

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.reviewDiscoveredTask,
        params: {
          discoveryId: BigInt(args.id),
          decision: decisionValue,
          reason: args.reason || undefined,
        },
      });
      success({ reviewed: true, id: args.id, decision });
    });
  },
});
