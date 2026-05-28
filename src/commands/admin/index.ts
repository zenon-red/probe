import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import assignHuman from "./assign-human.js";

export default defineSubcommandParent({
  name: "admin",
  description: "Privileged Nexus operations (Human role where required)",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe admin",
    description: "Privileged Nexus operations",
    usage: [
      "probe admin <subcommand> [positionals] [options]",
      "probe admin assign-human <identity-hex> --wallet human",
    ],
    actions: [
      {
        name: "assign-human <identity>",
        detail: "Grant Human role to an identity (caller must have Human role)",
      },
    ],
  },
  subCommands: {
    "assign-human": assignHuman,
  },
});
