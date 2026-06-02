import { defineSubcommandParent } from "~/utils/subcommand.js";
import reviewIdea from "./idea.js";
import reviewSpec from "./spec.js";

export default defineSubcommandParent({
  name: "review",
  description: "Human oversight reviews",
  help: {
    command: "probe human review",
    description: "Approve, reject, or request changes on ideas and project specs",
    usage: [
      "probe human review <target> <id> --decision <approved|rejected|changes-requested> [options]",
      "probe human review idea 42 --decision approved --wallet human",
      'probe human review spec 7 --decision changes-requested --comment "…" --wallet human',
    ],
    actions: [
      { name: "idea <id>", detail: "Review an idea in pending_human_review" },
      { name: "spec <id>", detail: "Review a submitted project spec" },
    ],
  },
  subCommands: {
    idea: reviewIdea,
    spec: reviewSpec,
  },
});
