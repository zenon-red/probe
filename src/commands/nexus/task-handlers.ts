import {
  CommandContext,
  callReducer,
  type Project,
  type Task,
  type TaskDependency,
  withAuth,
} from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { TaskStatus } from "~/utils/enums.js";
import { error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";

export interface TaskCommandArgs {
  action?: string;
  id?: string;
  status?: string;
  project?: string;
  title?: string;
  description?: string;
  priority?: string;
  assigned?: boolean;
  wallet?: string;
  "github-pr-url"?: string;
  "github-issue-url"?: string;
  "add-dep"?: string;
  list?: boolean;
  timeout?: string;
  limit?: string;
  host?: string;
  module?: string;
}

const normalizeGitHubRepoUrl = (githubRepo: string): string | undefined => {
  const value = githubRepo.trim().replace(/\.git$/i, "");
  if (!value) return undefined;

  if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
    return `https://github.com/${value}`;
  }

  const sshMatch = value.match(/^git@github\.com:([\w.-]+\/[\w.-]+)$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname !== "github.com") return undefined;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return undefined;
      return `https://github.com/${parts[0]}/${parts[1]}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export const runTaskAction = async (args: TaskCommandArgs): Promise<void> => {
  const action = args.action;
  if (!action) {
    error("ACTION_REQUIRED", "Task action required");
  }

  try {
    switch (action) {
      case "list": {
        await using ctx = await CommandContext.create({
          subscribe: ["SELECT * FROM tasks"],
        });
        let tasks = ctx.iter<Task>("tasks");
        const statusFilter = args.status;
        const limit = args.limit ? parseInt(args.limit, 10) : undefined;

        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          error("INVALID_LIMIT", "--limit must be a positive integer");
        }

        if (statusFilter) tasks = tasks.filter((t) => TaskStatus.matches(t.status, statusFilter));
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
        break;
      }

      case "ready": {
        await using ctx = await CommandContext.create({
          subscribe: ["SELECT * FROM tasks", "SELECT * FROM task_dependencies"],
        });
        const tasks = ctx.iter<Task>("tasks");
        const deps = ctx.iter<TaskDependency>("task_dependencies");
        const taskById = new Map(tasks.map((t) => [t.id.toString(), t]));
        const limit = args.limit ? parseInt(args.limit, 10) : undefined;

        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          error("INVALID_LIMIT", "--limit must be a positive integer");
        }

        const ready = tasks
          .filter((t) => TaskStatus.is.open(t.status))
          .filter((t) => {
            const incomingDeps = deps.filter((dep) => dep.taskId === t.id);
            const hasOpenBlocker = incomingDeps.some((dep) => {
              const depTag =
                typeof dep.dependencyType === "string"
                  ? dep.dependencyType
                  : dep.dependencyType.tag;
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
        break;
      }

      case "get": {
        const taskId = args.id;
        if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");

        await using ctx = await CommandContext.create({});
        const task = ctx.iter<Task>("tasks").find((t) => t.id.toString() === taskId);
        if (!task) error("TASK_NOT_FOUND", `Task not found: ${taskId}`);

        success(task);
        break;
      }

      case "create": {
        if (!args.project || !args.title) error("ARGS_REQUIRED", "--project and --title required");

        const priority = parseInt(args.priority || "5", 10);
        if (priority < 1 || priority > 10) error("INVALID_PRIORITY", "Priority must be 1-10");

        try {
          await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
            await callReducer(ctx, ctx.conn.reducers.createTask, {
              projectId: BigInt(args.project as string),
              title: args.title!,
              description: args.description || "",
              priority,
              sourceIdeaId: undefined,
              githubIssueUrl: args["github-issue-url"],
            });
          });
          success({
            created: true,
            projectId: args.project,
            title: args.title,
            issue: args["github-issue-url"],
          });
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "claim": {
        const taskId = args.id;
        if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");

        try {
          let repositoryUrl: string | undefined;
          let contributingUrl: string | undefined;

          await withAuth(
            {
              wallet: args.wallet,
              subscribe: ["SELECT * FROM tasks", "SELECT * FROM projects"],
            },
            async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.claimTask, { taskId: BigInt(taskId) });

              const task = ctx.iter<Task>("tasks").find((t) => t.id.toString() === taskId);
              const project = task
                ? ctx.iter<Project>("projects").find((p) => p.id === task.projectId)
                : undefined;

              if (project?.githubRepo) {
                repositoryUrl = normalizeGitHubRepoUrl(project.githubRepo);
                if (repositoryUrl) {
                  contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`;
                }
              }
            },
          );
          success(
            {
              claimed: true,
              taskId,
              repositoryUrl,
              contributingUrl,
            },
            [`probe task get ${taskId}`],
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "update": {
        const taskId = args.id;
        if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");
        if (!args.status && !args["github-pr-url"])
          error("UPDATE_REQUIRED", "--status or --github-pr-url required");

        try {
          await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
            await callReducer(ctx, ctx.conn.reducers.updateTaskStatus, {
              taskId: BigInt(taskId),
              status: args.status ? TaskStatus.fromString(args.status) : (undefined as never),
              githubPrUrl: args["github-pr-url"],
              archiveReason: undefined,
            });
          });
          success({
            updated: true,
            taskId,
            status: args.status,
            pr: args["github-pr-url"],
          });
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "review": {
        const taskId = args.id;
        if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");

        try {
          await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
            await callReducer(ctx, ctx.conn.reducers.updateTaskStatus, {
              taskId: BigInt(taskId),
              status: { tag: "Review" },
              githubPrUrl: args["github-pr-url"],
              archiveReason: undefined,
            });
          });
          success({
            reviewed: true,
            taskId,
            status: "review",
            pr: args["github-pr-url"],
          });
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "deps": {
        const taskId = args.id;
        if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");
        const taskIdBigInt = BigInt(taskId);

        if (args["add-dep"]) {
          try {
            await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.addTaskDependency, {
                taskId: taskIdBigInt,
                dependsOnId: BigInt(args["add-dep"] as string),
                dependencyType: { tag: "Blocks" },
              });
            });
            success({ added: true, taskId, dependsOn: args["add-dep"] });
          } catch (err) {
            error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
          }
        } else if (args.list) {
          await using ctx = await CommandContext.create({
            subscribe: ["SELECT * FROM task_dependencies"],
          });
          const deps = ctx.iter<TaskDependency>("task_dependencies");
          const taskDeps = deps.filter(
            (d) => d.taskId === taskIdBigInt || d.dependsOnId === taskIdBigInt,
          );

          success({ dependencies: taskDeps });
        } else {
          error(
            "DEPS_ACTION_REQUIRED",
            "Use --add-dep <taskId> to add a dependency or --list to view dependencies",
            "Examples: probe task deps 42 --list | probe task deps 42 --add-dep 17",
          );
        }
        break;
      }

      case "watch": {
        const timeout = Math.min(parseInt(args.timeout || "60", 10), 300);

        await withAuth(
          {
            wallet: args.wallet,
            subscribe: ["SELECT * FROM tasks"],
          },
          async (ctx) => {
            success({
              watching: true,
              timeoutSeconds: timeout,
              statusFilter: args.status || null,
            });

            const waitForStop = new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                process.off("SIGINT", onSignal);
                process.off("SIGTERM", onSignal);
                resolve();
              }, timeout * 1000);

              const onSignal = () => {
                clearTimeout(timer);
                process.off("SIGINT", onSignal);
                process.off("SIGTERM", onSignal);
                resolve();
              };

              process.on("SIGINT", onSignal);
              process.on("SIGTERM", onSignal);
            });

            ctx.db.tasks.onInsert((_ctx, task) => {
              if (!args.status || TaskStatus.matches(task.status, args.status)) {
                success({
                  id: task.id.toString(),
                  title: task.title,
                  change_type: "created",
                });
              }
            });

            ctx.db.tasks.onUpdate((_ctx, _old, newTask) => {
              if (!args.status || TaskStatus.matches(newTask.status, args.status)) {
                success({
                  id: newTask.id.toString(),
                  title: newTask.title,
                  change_type: "updated",
                });
              }
            });

            await waitForStop;
          },
        );
        break;
      }

      default:
        error(
          "INVALID_ACTION",
          `Invalid action: ${action}`,
          "Use: list, ready, get, create, claim, update, review, deps, watch",
        );
    }
  } catch (err) {
    const message = errorMessage(err);
    failWithConnectionOrUnexpected(message);
  }
};
