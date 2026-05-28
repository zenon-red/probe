import { defineCommand } from "citty";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";

export const taskCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new task" },
  args: {
    project: { type: "string", description: "Project ID" },
    title: { type: "string", description: "Task title" },
    description: { type: "string", description: "Task description" },
    "spec-requirement": {
      type: "string",
      description: "OpenSpec requirement name this task implements",
      required: true,
    },
    priority: { type: "string", description: "Priority 1-10", default: "5" },
    "github-issue-url": { type: "string", description: "GitHub issue URL" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (!args.project || !args.title || !args["spec-requirement"]) {
      error("ARGS_REQUIRED", "--project, --title, and --spec-requirement required");
    }

    const projectId = args.project;
    const title = args.title;
    const priority = parseInt(args.priority || "5", 10);
    if (priority < 1 || priority > 10) error("INVALID_PRIORITY", "Priority must be 1-10");

    await runReducerCommand(args, {
      subscribe: [],
      reducer: (ctx) => ctx.conn.reducers.createTask,
      params: {
        projectId: BigInt(projectId),
        title,
        description: args.description || "",
        specRequirement: args["spec-requirement"] as string,
        priority,
        sourceIdeaId: undefined,
        githubIssueUrl: args["github-issue-url"],
      },
    });
    success({
      created: true,
      projectId,
      title,
      specRequirement: args["spec-requirement"],
      issue: args["github-issue-url"],
    });
  },
});
