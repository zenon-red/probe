import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import create from "./create.js";
import defaultCmd from "./default.js";
import deleteCmd from "./delete.js";
import importCmd from "./import.js";
import list from "./list.js";
import show from "./show.js";

const walletSubcommands = new Set([
	"create",
	"import",
	"list",
	"show",
	"delete",
	"default",
]);

export default defineCommand({
	meta: {
		name: "wallet",
		description: "Manage Zenon Network wallets",
	},
	run() {
		const positionals = process.argv
			.slice(2)
			.filter((arg) => !arg.startsWith("-"));
		if (positionals.length > 1 && walletSubcommands.has(positionals[1])) {
			return;
		}

		printHelp({
			command: "probe wallet",
			description: "Create, import, inspect, and manage wallets",
			usage: [
				"probe wallet <subcommand> [positionals] [options]",
				"probe wallet create my-wallet --set-default",
				"probe wallet import my-wallet --mnemonic-file ./mnemonic.txt",
			],
			actions: [
				{ name: "create <name>", detail: "Create a new encrypted wallet" },
				{ name: "import <name>", detail: "Import wallet from mnemonic phrase" },
				{ name: "list", detail: "List stored wallets" },
				{
					name: "show <name>",
					detail: "Show wallet address and optional public key",
				},
				{ name: "delete <name>", detail: "Delete a wallet" },
				{ name: "default <name>", detail: "Set default wallet" },
			],
			notes: ["Use long-form flags only for predictable agent automation."],
		});
	},
	subCommands: {
		create,
		import: importCmd,
		list,
		show,
		delete: deleteCmd,
		default: defaultCmd,
	},
});
