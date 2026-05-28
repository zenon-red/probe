import { defineSubcommandParent } from "~/utils/subcommand.js";
import specReview from "./review.js";
import specShow from "./show.js";
import specSubmit from "./submit.js";
import specValidate from "./validate.js";

export default defineSubcommandParent({
  name: "spec",
  description: "Project spec reference and review",
  help: {
    command: "probe project spec",
    description: "Submit, review, show, and validate OpenSpec references",
    usage: [
      "probe project spec <subcommand> <project-id> [options]",
      "probe project spec show <id>",
      "probe project spec submit <id> --path openspec/... --commit <sha> --hash <sha256>",
    ],
    actions: [
      { name: "submit <id>", detail: "Submit spec ref for human review (Zoe/Admin)" },
      { name: "review <id>", detail: "Review spec (human role)" },
      { name: "show <id>", detail: "Show spec fields from Nexus" },
      { name: "validate <id>", detail: "Run openspec validate at spec ref commit" },
    ],
  },
  subCommands: {
    submit: specSubmit,
    review: specReview,
    show: specShow,
    validate: specValidate,
  },
});
