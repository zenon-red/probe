import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import ideaDimensions from "./idea/dimensions.js";
import ideaGet from "./idea/get.js";
import ideaList from "./idea/list.js";
import ideaPending from "./idea/pending.js";
import ideaPropose from "./idea/propose.js";
import ideaReview from "./idea/review.js";
import ideaVote from "./idea/vote.js";

export default defineSubcommandParent({
  name: "idea",
  description:
    "Idea discovery, review, and voting — list, pending, get, dimensions, propose, review, vote",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe idea",
    description: "Idea proposal and voting",
    usage: ["probe idea <subcommand> [positionals] [options]", "probe idea list"],
    actions: [
      { name: "list", detail: "List ideas" },
      { name: "pending", detail: "List pending ideas" },
      { name: "get <id>", detail: "Show one idea" },
      { name: "dimensions", detail: "List evaluation dimensions" },
      { name: "propose", detail: "Propose an idea" },
      { name: "review <id>", detail: "Review an idea (human role)" },
      { name: "vote <id>", detail: "Vote on an idea" },
    ],
  },
  subCommands: {
    list: ideaList,
    pending: ideaPending,
    get: ideaGet,
    dimensions: ideaDimensions,
    propose: ideaPropose,
    review: ideaReview,
    vote: ideaVote,
  },
});
