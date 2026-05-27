import { defineSubcommandParent } from "~/utils/subcommand.js";
import create from "./create.js";
import defaultCmd from "./default.js";
import deleteCmd from "./delete.js";
import importCmd from "./import.js";
import list from "./list.js";
import show from "./show.js";

export default defineSubcommandParent({
  name: "wallet",
  description: "Manage Zenon Network wallets",
  help: {
    command: "probe wallet",
    description: "Create, import, inspect, and manage wallets",
    usage: [
      "probe wallet <subcommand> [positionals] [options]",
      "probe wallet create human --set-default --password-file ~/.probe/human.pass",
      "probe wallet import my-wallet --mnemonic-file ./mnemonic.txt --password-file ./pass",
      "probe wallet show zr-zoe --password-file ~/.probe/zr-zoe.pass",
    ],
    actions: [
      {
        name: "create <name>",
        detail: "Create wallet (--password-file or PROBE_WALLET_PASSWORD)",
      },
      {
        name: "import <name>",
        detail: "Import from mnemonic (--mnemonic-file, --password-file)",
      },
      { name: "list", detail: "List stored wallets (no password)" },
      {
        name: "show <name>",
        detail: "Address / public key (--password-file when unlocking)",
      },
      { name: "delete <name>", detail: "Delete a wallet" },
      { name: "default <name>", detail: "Set default wallet" },
    ],
    notes: [
      "Use long-form flags only for predictable agent automation.",
      "Encrypted wallets: pass --password-file <path> or set PROBE_WALLET_PASSWORD (no interactive prompt).",
      "Same password flags apply to probe login <wallet> --password-file <path> --save.",
    ],
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
