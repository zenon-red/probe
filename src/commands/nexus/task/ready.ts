import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { TaskStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";

export const taskReadyCommand = defineCommand({
  meta: { name: "ready", description: "List immediately claimable open tasks" },
  args: {
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
        commandContextOptions(args, {
          subscribe: ["SELECT * FROM tasks", "SELECT * FROM task_dependencies"],
        }),
      );
      const tasks = ctx.tasks;
      const deps = ctx.taskDependencies;
      const taskById = new Map(tasks.map((t) => [t.id.toString(), t]));

      const ready = tasks
        .filter((t) => TaskStatus.is.open(t.status))
        .filter((t) => {
          const incomingDeps = deps.filter((dep) => dep.taskId === t.id);
          const hasOpenBlocker = incomingDeps.some((dep) => {
            const depTag =
              typeof dep.dependencyType === "string" ? dep.dependencyType : dep.dependencyType.tag;
            if (
              depTag !== "Blocks" &&
              depTag !== "ParentChild" &&
              depTag !== "blocks" &&
              depTag !== "parent-child"
            )
              return false;
            const blocker = taskById.get(dep.dependsOnId.toString());
            if (!blocker) return false;
            return !TaskStatus.is.completed(blocker.status);
          });
          return !hasOpenBlocker;
        })
        .filter((t) => !args.project || t.projectId.toString() === args.project)
        .filter((t) => !args.assigned || Boolean(t.assignedTo))
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          const aMicros = toMicros(a.createdAt);
          const bMicros = toMicros(b.createdAt);
          if (aMicros < bMicros) return -1;
          if (aMicros > bMicros) return 1;
          return 0;
        });

      const readyTasks = (limit !== undefined ? ready.slice(0, limit) : ready).map((t) => ({
        id: t.id.toString(),
        title: t.title,
        status: t.status.tag.toLowerCase(),
        priority: t.priority,
        assignedTo: t.assignedTo || "",
        projectId: t.projectId.toString(),
        blockedBy: [] as string[],
      }));

      success({ tasks: readyTasks, count: readyTasks.length });
    } catch (err) {
      failWithConnectionOrUnexpected(errorMessage(err));
    }
  },
});
