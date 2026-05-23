import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, commandContextOptions, withAuth } from "~/utils/context.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { currentAgentForIdentity, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "status", description: "Show current agent status" },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
        const myAgent = currentAgentForIdentity(ctx);
        if (!myAgent) {
          error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");
        }

        success(myAgent);
      });
    });
  },
});
