import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { deleteWallet, walletExists } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "delete",
    description: "Delete a wallet",
  },
  args: {
    name: {
      type: "positional",
      description: "Wallet name",
      required: false,
    },
    yes: {
      type: "boolean",
      description: "Confirm wallet deletion (required)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    const name = args.name;

    if (forceHelpRequested() || !name) {
      printHelp({
        command: "probe wallet delete",
        description: "Delete a wallet from local storage",
        usage: ["probe wallet delete <name> [options]", "probe wallet delete old-wallet --yes"],
        options: [
          {
            name: "--yes",
            detail: "Required — confirm destructive deletion (no interactive prompt)",
          },
          { name: "--json", detail: "JSON output for agents" },
        ],
        notes: ["Interactive confirmation is not supported. Pass --yes to delete."],
      });
      return;
    }

    const exists = await walletExists(name);
    if (!exists) {
      error(
        "WALLET_NOT_FOUND",
        `Wallet '${name}' does not exist`,
        `Run 'probe wallet list' to see available wallets`,
      );
    }

    if (!args.yes) {
      error(
        "CONFIRMATION_REQUIRED",
        `Deleting wallet "${name}" requires --yes`,
        `Run: probe wallet delete ${name} --yes`,
      );
    }

    try {
      await deleteWallet(name);
      success({ deleted: name });
    } catch (err) {
      error("WALLET_DELETE_ERROR", errorMessage(err, "Failed to delete wallet"));
    }
  },
});
