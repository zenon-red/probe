import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import discoverGet from "./discover/get.js";
import discoverList from "./discover/list.js";
import discoverReport from "./discover/report.js";
import discoverReview from "./discover/review.js";

export default defineSubcommandParent({
  name: "discover",
  description: "Discovered task reporting and review — report, review, list, get",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe discover",
    description: "Discovery reporting and review",
    usage: ["probe discover <subcommand> [positionals] [options]", "probe discover list"],
    actions: [
      { name: "report", detail: "Report a discovered task" },
      { name: "review <id>", detail: "Review a discovered task" },
      { name: "list", detail: "List discovered tasks" },
      { name: "get <id>", detail: "Show one discovered task" },
    ],
  },
  subCommands: {
    report: discoverReport,
    review: discoverReview,
    list: discoverList,
    get: discoverGet,
  },
});
