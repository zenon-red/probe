import { defineSubcommandParent } from "~/utils/subcommand.js";
import status from "./status.js";

export default defineSubcommandParent({
  name: "auth",
  description: "Inspect authentication status",
  help: {
    command: "probe auth",
    description: "Inspect cached authentication status",
    usage: ["probe auth status [--wallet <name>]", "probe auth status --wallet my-wallet"],
    actions: [{ name: "status", detail: "Show cached authentication status for a wallet" }],
    notes: [
      "Authenticate with `probe login <wallet>`. Inspect or clear cached tokens with `probe token show|clear`.",
    ],
  },
  subCommands: {
    status,
  },
});
