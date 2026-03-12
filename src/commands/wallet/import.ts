import { defineCommand } from "citty";
import {
	resolveMnemonicInput,
	resolvePasswordInput,
} from "~/utils/credentials.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import {
	error,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
} from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { importWallet, listWallets } from "~/utils/wallet.js";

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
		if (args.json) {
			setJsonMode(true);
		}

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
					"Mnemonic source order: --mnemonic, --mnemonic-file, PROBE_WALLET_MNEMONIC, interactive prompt.",
				],
			});
			return;
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			error(
				"INVALID_NAME",
				"Wallet name must be alphanumeric with hyphens or underscores only",
			);
		}

		const mnemonicPhrase = await resolveMnemonicInput({
			mnemonic: args.mnemonic,
			mnemonicFile: args["mnemonic-file"],
			jsonModeError:
				"Mnemonic required via --mnemonic, --mnemonic-file, or PROBE_WALLET_MNEMONIC env",
		});

		const walletPassword = await resolvePasswordInput({
			passwordFile: args["password-file"],
			promptMessage: "Enter password to encrypt wallet:",
			jsonModeError:
				"Password required via PROBE_WALLET_PASSWORD env, --password-file, or interactive prompt",
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

			if (!isJsonMode()) {
				successMessage(`Wallet "${result.name}" imported successfully`);
				console.log(`Address: ${result.address}`);
				if (setAsDefault) {
					console.log(`\nSet as default wallet`);
				}
			}
		} catch (err) {
			error(
				"WALLET_IMPORT_ERROR",
				err instanceof Error ? err.message : "Failed to import wallet",
			);
		}
	},
});
