import { defineCommand } from "citty";
import { getConfig } from "~/utils/config.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, info, isJsonMode, success } from "~/utils/output.js";
import { listWallets } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List all stored wallets",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    if (forceHelpRequested()) {
      printHelp({
        command: "probe wallet list",
        description: "List all locally stored wallets",
        usage: ["probe wallet list [options]", "probe wallet list --json"],
        options: [{ name: "--json", detail: "JSON output for agents" }],
      });
      return;
    }

    applyJsonMode(args);

    try {
      const wallets = await listWallets();
      const config = await getConfig();

      const walletsOutput = wallets.map((w) => ({
        ...w,
        default: w.name === config.defaultWallet,
      }));

      success(walletsOutput);

      if (!isJsonMode()) {
        if (wallets.length === 0) {
          info("No wallets found");
        } else {
          console.log("Wallets:");
          for (const wallet of walletsOutput) {
            const date = wallet.createdAt
              ? new Date(wallet.createdAt).toLocaleDateString()
              : "unknown";
            const marker = wallet.default ? "*" : " ";
            console.log(
              `${marker} ${wallet.name.padEnd(12)} ${wallet.address.slice(0, 10)}...  created ${date}`,
            );
          }
          if (config.defaultWallet) {
            console.log(`\n* = default wallet`);
          }
        }
      }
    } catch (err) {
      error("WALLET_LIST_ERROR", errorMessage(err, "Failed to list wallets"));
    }
  },
});
