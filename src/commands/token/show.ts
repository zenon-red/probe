import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "show",
    description: "Show cached JWT token for wallet",
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
        command: "probe token show",
        description: "Inspect cached authentication token",
        usage: ["probe token show <wallet>", "probe token show my-wallet"],
        options: [{ name: "--json", detail: "JSON output for agents" }],
      });
      return;
    }

    try {
      const cached = await getCachedToken(walletName);

      if (!cached) {
        error(
          "TOKEN_NOT_FOUND",
          `No cached token for wallet '${walletName}'`,
          `Run 'probe login ${walletName} --save' to authenticate`,
        );
      }

      const expiresAt = new Date(cached.expiresAt);
      const now = new Date();
      const expiresIn = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
      const valid = expiresIn > 0;

      success({
        wallet: walletName,
        token: cached.token,
        expiresAt: cached.expiresAt,
        expiresIn: Math.max(0, expiresIn),
        valid,
        ...(valid
          ? {}
          : {
              hint: "Token has expired. Run `probe token clear` to remove it and re-authenticate.",
            }),
      });
    } catch (err) {
      error("TOKEN_ERROR", errorMessage(err, "Failed to read token"));
    }
  },
});
