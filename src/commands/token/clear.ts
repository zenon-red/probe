import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { clearCachedToken } from "~/utils/token-cache.js";

export default defineCommand({
  meta: {
    name: "clear",
    description: "Clear cached JWT token for wallet",
  },
  args: {
    wallet: {
      type: "positional",
      description: "Wallet name",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    const walletName = args.wallet;

    if (forceHelpRequested() || !walletName) {
      printHelp({
        command: "probe token clear",
        description: "Clear cached authentication token",
        usage: ["probe token clear <wallet>", "probe token clear my-wallet"],
        options: [{ name: "--json", detail: "JSON output for agents" }],
      });
      return;
    }

    await clearCachedToken(walletName);

    success({ cleared: walletName, message: `Token cache cleared for "${walletName}"` }, [
      `probe login ${walletName} --save`,
    ]);
  },
});
