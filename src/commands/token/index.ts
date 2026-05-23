import { defineSubcommandParent } from "~/utils/subcommand.js";
import clear from "./clear.js";
import show from "./show.js";

export default defineSubcommandParent({
  name: "token",
  description: "Inspect or clear cached authentication token",
  help: {
    command: "probe token",
    description: "Inspect or clear cached authentication token",
    usage: [
      "probe token <subcommand> <wallet> [options]",
      "probe token show my-wallet",
      "probe token clear my-wallet",
    ],
    actions: [
      { name: "show <wallet>", detail: "Show cached token and expiry" },
      { name: "clear <wallet>", detail: "Clear cached token" },
    ],
  },
  subCommands: {
    show,
    clear,
  },
});
