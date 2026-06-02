import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import assign from "./assign.js";
import dispatch from "./dispatch.js";
import review from "./review/index.js";

export default defineSubcommandParent({
  name: "human",
  description: "Human-role operator commands (identity assignment, dispatch, reviews)",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe human",
    description: "Human-role operator surface (not Admin agent role)",
    usage: [
      "probe human <subcommand> [positionals] [options]",
      "probe human assign <identity-hex> --wallet human",
      "probe human dispatch status --wallet human",
      "probe human review idea <id> --decision approved --wallet human",
    ],
    actions: [
      { name: "assign <identity>", detail: "Grant Human role to an identity" },
      { name: "dispatch <on|off|status>", detail: "Module dispatch_enabled kill switch" },
      { name: "review idea <id>", detail: "Review an idea" },
      { name: "review spec <id>", detail: "Review a project spec" },
    ],
    notes: [
      "Caller must have Human role in identity_roles (use --wallet human in lab).",
      "Agent review completion uses probe review, not probe human review.",
    ],
  },
  subCommands: {
    assign,
    dispatch,
    review,
  },
});
