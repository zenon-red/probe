import { defineCommand } from "citty";
import { resolveMnemonicInput, resolvePasswordInput } from "~/utils/credentials.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { importWallet, listWallets } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "import",
    description: "Import wallet from mnemonic phrase",
  },
  args: {
    name: {
      type: "positional",
      description: "Wallet identifier",
      required: false,
    },
    mnemonic: {
      type: "string",
      description: "Mnemonic phrase (space-separated)",
    },
    "mnemonic-file": {
      type: "string",
      description: "Read mnemonic from file",
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
        command: "probe wallet import",
        description: "Import an encrypted wallet from mnemonic",
        usage: [
          "probe wallet import <name> [options]",
          "probe wallet import agent-wallet --mnemonic-file ./mnemonic.txt",
        ],
        options: [
          { name: "--mnemonic", detail: "24-word mnemonic phrase" },
          { name: "--mnemonic-file", detail: "Read mnemonic from file" },
          { name: "--password-file", detail: "Read wallet password from file" },
          { name: "--set-default", detail: "Set imported wallet as default" },
          { name: "--json", detail: "JSON output for agents" },
        ],
        notes: [
          "Mnemonic source order: --mnemonic, --mnemonic-file, PROBE_WALLET_MNEMONIC. Interactive prompts are not supported.",
          "Password source order: --password-file, PROBE_WALLET_PASSWORD. Interactive prompts are not supported.",
        ],
      });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      error("INVALID_NAME", "Wallet name must be alphanumeric with hyphens or underscores only");
    }

    const mnemonicPhrase = await resolveMnemonicInput({
      mnemonic: args.mnemonic,
      mnemonicFile: args["mnemonic-file"],
      jsonModeError: "Mnemonic required via --mnemonic, --mnemonic-file, or PROBE_WALLET_MNEMONIC",
    });

    const walletPassword = await resolvePasswordInput({
      passwordFile: args["password-file"],
      jsonModeError: "Password required via --password-file or PROBE_WALLET_PASSWORD",
    });

    try {
      const result = await importWallet(name, mnemonicPhrase, walletPassword);

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
        default: setAsDefault,
      });
    } catch (err) {
      error("WALLET_IMPORT_ERROR", errorMessage(err, "Failed to import wallet"));
    }
  },
});
