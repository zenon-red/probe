import { defineCommand } from "citty";
import { resolvePasswordInput } from "~/utils/credentials.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { createWallet as createWalletUtil, listWallets } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new wallet with randomly generated mnemonic",
  },
  args: {
    name: {
      type: "positional",
      description: "Wallet identifier",
      required: false,
    },
    "password-file": {
      type: "string",
      description: "Read password from file",
    },
    "set-default": {
      type: "boolean",
      description: "Set this wallet as the default",
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
        command: "probe wallet create",
        description: "Create a new encrypted wallet",
        usage: [
          "probe wallet create <name> [options]",
          "probe wallet create agent-wallet --set-default",
        ],
        options: [
          { name: "--password-file", detail: "Read wallet password from file" },
          { name: "--set-default", detail: "Set created wallet as default" },
          { name: "--json", detail: "JSON output for agents" },
        ],
        notes: [
          "Password source order: --password-file, PROBE_WALLET_PASSWORD. Interactive prompts are not supported.",
        ],
      });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      error("INVALID_NAME", "Wallet name must be alphanumeric with hyphens or underscores only");
    }

    const walletPassword = await resolvePasswordInput({
      passwordFile: args["password-file"],
      jsonModeError: "Password required via --password-file or PROBE_WALLET_PASSWORD",
    });

    try {
      const result = await createWalletUtil(name, walletPassword);

      let setAsDefault = args["set-default"];
      if (!setAsDefault) {
        const wallets = await listWallets();
        if (wallets.length === 1) {
          setAsDefault = true;
        }
      }

      if (setAsDefault) {
        const userConfig = await loadUserConfig();
        userConfig.defaultWallet = result.name;
        await saveUserConfig(userConfig);
      }

      success({
        name: result.name,
        address: result.address,
        publicKey: result.publicKey,
        mnemonic: result.mnemonic,
        default: setAsDefault,
        warning: "Save this mnemonic securely - it cannot be recovered!",
      });
    } catch (err) {
      error("WALLET_CREATE_ERROR", errorMessage(err, "Failed to create wallet"));
    }
  },
});
