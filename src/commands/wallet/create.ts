import { defineCommand } from "citty";
import { getConfig } from "~/utils/config.js";
import { resolvePasswordInput } from "~/utils/credentials.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import {
	error,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
	warning,
} from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import {
	createWallet as createWalletUtil,
	listWallets,
} from "~/utils/wallet.js";

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
		if (args.json) {
			setJsonMode(true);
		}

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
					"Password source order: --password-file, PROBE_WALLET_PASSWORD, interactive prompt.",
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

		const config = await getConfig();
		const walletPassword = await resolvePasswordInput({
			passwordFile: args["password-file"],
			promptMessage: "Enter password to encrypt wallet:",
			confirmPromptMessage: "Confirm password:",
			minLength: config.passwordMinLength,
			jsonModeError:
				"Password required via PROBE_WALLET_PASSWORD env, --password-file, or interactive prompt",
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
			});

			if (!isJsonMode()) {
				successMessage(`Wallet "${result.name}" created successfully`);
				console.log(`Address: ${result.address}`);
				console.log(`\nMnemonic: ${result.mnemonic}`);
				warning("Save this mnemonic securely - it cannot be recovered!");
				if (setAsDefault) {
					console.log(`\nSet as default wallet`);
				}
			}
		} catch (err) {
			error(
				"WALLET_CREATE_ERROR",
				err instanceof Error ? err.message : "Failed to create wallet",
			);
		}
	},
});
