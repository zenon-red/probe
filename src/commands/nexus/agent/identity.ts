import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, commandContextOptions, withAuth } from "~/utils/context.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "identity", description: "Show current authenticated identity" },
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
        const identityHex = ctx.identity?.toHexString();
        success({ identity: identityHex, wallet: args.wallet });
      });
    });
  },
});
