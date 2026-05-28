import { defineCommand } from "citty";
import { getConfig } from "~/utils/config.js";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { AgentRole } from "~/utils/enums.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { getWalletInfo } from "~/utils/wallet.js";
import { normalizeCapabilities, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "register", description: "Register a new agent identity" },
  args: {
    agentId: {
      type: "positional",
      name: "agentId",
      description: "Agent ID",
      required: true,
    },
    name: { type: "positional", name: "name", description: "Display name", required: true },
    role: {
      type: "positional",
      name: "role",
      description: "Role: zoe, admin, zeno, human (default: zeno)",
      required: false,
    },
    address: { type: "string", description: "Zenon address" },
    wallet: { type: "string", description: "Wallet name" },
    capabilities: { type: "string", description: "Comma-separated capability list" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const agentId = args.agentId;
    const name = args.name;
    const role = args.role || "zeno";

    await runWithBoundary(async () => {
      const config = await getConfig();
      const walletName = args.wallet || config.defaultWallet;
      if (!args.address && !walletName) {
        error("WALLET_REQUIRED", "--address or --wallet required (or set default wallet)");
      }

      let address = args.address;
      const capabilities = normalizeCapabilities(args.capabilities);
      if (!address && walletName) {
        const wallet = await getWalletInfo(walletName);
        if (!wallet) error("WALLET_NOT_FOUND", `Wallet not found: ${walletName}`);
        address = wallet.address;
      }

      try {
        await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.registerAgent, {
            agentId,
            name,
            role: AgentRole.fromString(role),
            zenonAddress: address as string,
          });

          if (capabilities.length > 0) {
            await callReducer(ctx, ctx.conn.reducers.updateAgentCapabilities, {
              capabilities,
            });
          }

          await new Promise((r) => setTimeout(r, 500));
          const registered = ctx.agents.find((a) => a.id === agentId);
          if (!registered) {
            if (role === "zoe" || role === "admin") {
              error("UNAUTHORIZED", "Only whitelisted identities can register as zoe or admin");
            }
            error("REGISTRATION_FAILED", "Registration failed");
          }
        });
        success({
          registered: true,
          agentId,
          name,
          role,
          address,
          capabilities,
        });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
