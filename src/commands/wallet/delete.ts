import { confirm } from "@clack/prompts";
import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import {
	error,
	info,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
} from "~/utils/output.js";
import { deleteWallet, walletExists } from "~/utils/wallet.js";

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
			description: "Skip confirmation prompt",
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
				command: "probe wallet delete",
				description: "Delete a wallet from local storage",
				usage: [
					"probe wallet delete <name> [options]",
					"probe wallet delete old-wallet --yes",
				],
				options: [
					{ name: "--yes", detail: "Skip interactive confirmation prompt" },
					{ name: "--json", detail: "JSON output for agents" },
				],
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

		if (!isJsonMode() && !args.yes) {
			const shouldDelete = await confirm({
				message: `Are you sure you want to delete wallet "${name}"? This cannot be undone.`,
			});

			if (!shouldDelete) {
				info("Deletion cancelled");
				process.exit(0);
			}
		}

		try {
			await deleteWallet(name);

			success({ deleted: name });

			if (!isJsonMode()) {
				successMessage(`Wallet "${name}" deleted successfully`);
			}
		} catch (err) {
			error(
				"WALLET_DELETE_ERROR",
				err instanceof Error ? err.message : "Failed to delete wallet",
			);
		}
	},
});
