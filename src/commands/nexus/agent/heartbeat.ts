import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { currentAgentForIdentity, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "heartbeat", description: "Send heartbeat for authenticated agent" },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      try {
        await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
          const myAgent = currentAgentForIdentity(ctx);
          if (!myAgent) error("NOT_REGISTERED", "Agent not registered");

          await callReducer(ctx, ctx.conn.reducers.heartbeat, {
            agentId: myAgent.id,
          });
          success({ heartbeat: true });
        });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
