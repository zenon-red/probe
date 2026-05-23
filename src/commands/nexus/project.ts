import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import projectCreate from "./project/create.js";
import projectGet from "./project/get.js";
import projectList from "./project/list.js";
import projectSetStatus from "./project/set-status.js";
import projectStatus from "./project/status.js";

export default defineSubcommandParent({
  name: "project",
  description: "Project commands — list, get, status, create, set-status",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe project",
    description: "Project management",
    usage: ["probe project <subcommand> [positionals] [options]", "probe project list"],
    actions: [
      { name: "list", detail: "List projects" },
      { name: "get <id>", detail: "Show one project" },
      { name: "status <id>", detail: "Show project status" },
      { name: "create", detail: "Create a project" },
      { name: "set-status <id>", detail: "Set project status" },
    ],
  },
  subCommands: {
    list: projectList,
    get: projectGet,
    status: projectStatus,
    create: projectCreate,
    "set-status": projectSetStatus,
  },
});
