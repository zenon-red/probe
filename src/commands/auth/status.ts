import { defineCommand } from "citty";
import { getConfig } from "~/utils/config.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { getCachedToken } from "~/utils/token-cache.js";

export default defineCommand({
  meta: {
    name: "status",
    description: "Show cached authentication status for a wallet",
  },
  args: {
    wallet: {
      type: "string",
      description: "Wallet name (defaults to configured default wallet)",
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (forceHelpRequested()) {
      printHelp({
        command: "probe auth status",
        description: "Inspect cached token validity for a wallet",
        usage: ["probe auth status [--wallet my-wallet]"],
        options: [{ name: "--wallet", detail: "Wallet name (defaults to configured default)" }],
      });
      return;
    }

    const config = await getConfig();
    const walletName = args.wallet || config.defaultWallet;
    if (!walletName) {
      error("WALLET_REQUIRED", "Wallet required. Use --wallet or set default wallet.");
    }

    const cached = await getCachedToken(walletName);
    if (!cached) {
      success(
        {
          wallet: walletName,
          authenticated: false,
          valid: false,
          reason: "no_cached_token",
        },
        [`probe login ${walletName} --password-file <path> --save`],
      );
      return;
    }

    const expiresAt = new Date(cached.expiresAt);
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    const valid = Number.isFinite(expiresIn) && expiresIn > 0;
    success({
      wallet: walletName,
      authenticated: true,
      valid,
      expiresAt: cached.expiresAt,
      expiresIn: Math.max(0, expiresIn),
    });
  },
});
