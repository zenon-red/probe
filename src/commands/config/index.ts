import { defineSubcommandParent } from "~/utils/subcommand.js";
import get from "./get.js";
import list from "./list.js";
import set from "./set.js";

export default defineSubcommandParent({
  name: "config",
  description: "Manage configuration settings",
  help: {
    command: "probe config",
    description: "Read and write CLI configuration values",
    usage: [
      "probe config <subcommand> [positionals] [options]",
      "probe config get spacetime.host",
      "probe config set defaultWallet agent-wallet",
    ],
    actions: [
      { name: "get <key>", detail: "Get one config value" },
      { name: "set <key> <value>", detail: "Set one config value" },
      { name: "list", detail: "List merged config and user overrides" },
    ],
    notes: [
      "Valid keys: issuer, walletDir, defaultWallet, autoUpdate, tokenCacheDir, requestTimeout, spacetime.host, spacetime.module.",
    ],
  },
  subCommands: {
    get,
    set,
    list,
  },
});
