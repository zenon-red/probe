import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { collectAcpCapabilities } from "~/acp/capabilities.js";
import { loadUserConfig } from "~/utils/user-config.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { currentAgentForIdentity, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "capabilities", description: "Refresh ACP-derived capabilities" },
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
        const localConfig = await loadUserConfig();
        if (!localConfig.harness) {
          error(
            "HARNESS_REQUIRED",
            "Configure a harness first with probe onboard --harness <name>",
          );
        }
        const capabilities = await collectAcpCapabilities({
          harness: localConfig.harness,
          harnessCommand: localConfig.harnessCommand,
          acpConfig: localConfig.acp,
        });
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
