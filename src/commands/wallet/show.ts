import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { getWalletInfo, loadWallet } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "show",
    description: "Show wallet address and public key",
  },
  args: {
    name: {
      type: "positional",
      description: "Wallet name",
      required: false,
    },
    "public-key": {
      type: "boolean",
      description: "Include public key in output",
      default: false,
    },
    "password-file": {
      type: "string",
      description: "Read password from file",
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
        command: "probe wallet show",
        description: "Show wallet address and optional public key",
        usage: [
          "probe wallet show <name> [options]",
          "probe wallet show my-wallet --public-key --password-file ./pass.txt",
        ],
        options: [
          { name: "--public-key", detail: "Include public key in output" },
          {
            name: "--password-file",
            detail: "Read password for public key extraction",
          },
          { name: "--json", detail: "JSON output for agents" },
        ],
      });
      return;
    }

    const walletInfo = await getWalletInfo(name);
    if (!walletInfo) {
      error(
        "WALLET_NOT_FOUND",
        `Wallet '${name}' does not exist`,
        `Run 'probe wallet list' to see available wallets`,
      );
    }

    let walletPassword: string | undefined;

    if (args["password-file"]) {
      try {
        walletPassword = await readFile(args["password-file"], "utf-8");
        walletPassword = walletPassword.trim();
      } catch {
        error("FILE_READ_ERROR", `Failed to read password file: ${args["password-file"]}`);
      }
    }

    try {
      let publicKey: string | undefined;

      if (walletPassword) {
        const keyStore = await loadWallet(name, walletPassword);
        const keyPair = keyStore.getKeyPair(0);
        publicKey = keyPair.getPublicKey().toString("hex");
      }

      const result: Record<string, string | undefined> = {
        name: walletInfo.name,
        address: walletInfo.address,
        createdAt: walletInfo.createdAt,
      };

      if (args["public-key"] || publicKey) {
        result.publicKey = publicKey;
      }

      success(result);
    } catch (err) {
      error("WALLET_LOAD_ERROR", errorMessage(err, "Failed to load wallet"));
    }
  },
});
