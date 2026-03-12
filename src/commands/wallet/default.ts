import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import {
	error,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
} from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { walletExists } from "~/utils/wallet.js";

export default defineCommand({
	meta: {
		name: "default",
		description: "Set the default wallet",
	},
	args: {
		name: {
			type: "positional",
			description: "Wallet name to set as default",
			required: false,
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
				command: "probe wallet default",
				description: "Set the default wallet used by commands",
				usage: [
					"probe wallet default <name> [options]",
					"probe wallet default agent-wallet",
				],
				options: [{ name: "--json", detail: "JSON output for agents" }],
			});
			return;
		}

		const exists = await walletExists(name);
		if (!exists) {
			error("WALLET_NOT_FOUND", `Wallet '${name}' does not exist`);
		}

		const userConfig = await loadUserConfig();
		userConfig.defaultWallet = name;
		await saveUserConfig(userConfig);

		success({ defaultWallet: name });

		if (!isJsonMode()) {
			successMessage(`Default wallet set to '${name}'`);
		}
	},
});
