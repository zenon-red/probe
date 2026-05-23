import { defineSubcommandParent } from "~/utils/subcommand.js";
import { taskClaimCommand } from "./task/claim.js";
import { taskCreateCommand } from "./task/create.js";
import { taskDepsCommand } from "./task/deps.js";
import { taskGetCommand } from "./task/get.js";
import { taskListCommand } from "./task/list.js";
import { taskReadyCommand } from "./task/ready.js";
import { taskReviewCommand } from "./task/review.js";
import { taskUpdateCommand } from "./task/update.js";
import { taskWatchCommand } from "./task/watch.js";

export default defineSubcommandParent({
  name: "task",
  description: "Task management",
  help: {
    command: "probe task",
    description: "Task lifecycle and claiming",
    usage: [
      "probe task <subcommand> [positionals] [options]",
      "probe task list",
      "probe task claim 42 --wallet agent-wallet",
    ],
    actions: [
      { name: "list", detail: "List tasks with optional filters" },
      { name: "ready", detail: "List tasks ready to claim" },
      { name: "get <id>", detail: "Show one task" },
      { name: "create", detail: "Create a task" },
      { name: "claim <id>", detail: "Claim a task" },
      { name: "update <id>", detail: "Update a task" },
      { name: "review <id>", detail: "Submit a task review" },
      { name: "deps <id>", detail: "Show task dependencies" },
      { name: "watch <id>", detail: "Watch a task for changes" },
    ],
  },
  subCommands: {
    list: taskListCommand,
    ready: taskReadyCommand,
    get: taskGetCommand,
    create: taskCreateCommand,
    claim: taskClaimCommand,
    update: taskUpdateCommand,
    review: taskReviewCommand,
    deps: taskDepsCommand,
    watch: taskWatchCommand,
  },
});
