import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { TaskStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";

export const taskListCommand = defineCommand({
  meta: { name: "list", description: "List tasks with optional filters" },
  args: {
    status: { type: "string", description: "Status filter" },
    project: { type: "string", description: "Project ID" },
    assigned: {
      type: "boolean",
      description: "Show only assigned tasks",
      default: false,
    },
    limit: { type: "string", description: "Limit rows" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const limit = args.limit ? parseInt(args.limit, 10) : undefined;

    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      error("INVALID_LIMIT", "--limit must be a positive integer");
    }

    try {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM tasks"] }),
      );
      let tasks = ctx.tasks;

      if (args.status) tasks = tasks.filter((t) => TaskStatus.matches(t.status, args.status!));
      if (args.project) tasks = tasks.filter((t) => t.projectId.toString() === args.project);
      if (args.assigned) tasks = tasks.filter((t) => t.assignedTo);

      tasks = tasks.sort((a, b) => {
        const aMicros = toMicros(a.createdAt);
        const bMicros = toMicros(b.createdAt);
        if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
        if (a.id === b.id) return 0;
        return b.id > a.id ? 1 : -1;
      });

      if (limit !== undefined) tasks = tasks.slice(0, limit);

      success({ tasks, count: tasks.length });
    } catch (err) {
      failWithConnectionOrUnexpected(errorMessage(err));
    }
  },
});
