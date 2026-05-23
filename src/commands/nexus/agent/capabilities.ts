import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { currentAgentForIdentity, normalizeCapabilities, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "capabilities", description: "Set capabilities for authenticated agent" },
  args: {
    set: { type: "string", description: "Comma-separated capability list", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const capabilities = normalizeCapabilities(args.set);

    await runWithBoundary(async () => {
      try {
        await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.updateAgentCapabilities, {
            capabilities,
          });
          const myAgent = currentAgentForIdentity(ctx);
          success({ updated: true, agentId: myAgent?.id, capabilities });
        });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
