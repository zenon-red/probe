import {
	CommandContext,
	callReducer,
	type Project,
	type Task,
	type TaskDependency,
	withAuth,
} from "~/utils/context.js";
import { TaskStatus } from "~/utils/enums.js";
import { error, isJsonMode, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

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
					host: args.host,
					module: args.module,
				});
				let tasks = ctx.iter<Task>("tasks");
				const statusFilter = args.status;
				const limit = args.limit ? parseInt(args.limit, 10) : undefined;

				if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
					error("INVALID_LIMIT", "--limit must be a positive integer");
				}

				if (statusFilter)
					tasks = tasks.filter((t) =>
						TaskStatus.matches(t.status, statusFilter),
					);
				if (args.project)
					tasks = tasks.filter((t) => t.projectId.toString() === args.project);
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
				if (!isJsonMode()) {
					console.log(
						toonList(
							"tasks",
							tasks.map((t) => ({
								id: t.id.toString(),
								title: t.title,
								status: TaskStatus.display(t.status),
								priority: t.priority,
								assignedTo: t.assignedTo || "",
								projectId: t.projectId,
							})),
						),
					);
				}
				break;
			}

			case "ready": {
				await using ctx = await CommandContext.create({
					host: args.host,
					module: args.module,
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
					.filter(
						(t) => !args.project || t.projectId.toString() === args.project,
					)
					.filter((t) => !args.assigned || Boolean(t.assignedTo))
					.sort((a, b) => {
						if (a.priority !== b.priority) return a.priority - b.priority;
						const aMicros = toMicros(a.createdAt);
						const bMicros = toMicros(b.createdAt);
						if (aMicros < bMicros) return -1;
						if (aMicros > bMicros) return 1;
						return 0;
					});

				const readyTasks = (
					limit !== undefined ? ready.slice(0, limit) : ready
				).map((t) => ({
					id: t.id.toString(),
					title: t.title,
					status: t.status.tag.toLowerCase(),
					priority: t.priority,
					assignedTo: t.assignedTo || "",
					projectId: t.projectId.toString(),
					blockedBy: [] as string[],
				}));

				success({ tasks: readyTasks, count: readyTasks.length });
				if (!isJsonMode()) {
					console.log(
						toonList(
							"tasks",
							readyTasks.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								priority: t.priority,
								assignedTo: t.assignedTo,
								projectId: t.projectId,
							})),
						),
					);
				}
				break;
			}

			case "get": {
				const taskId = args.id;
				if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");

				await using ctx = await CommandContext.create({
					host: args.host,
					module: args.module,
				});
				const task = ctx
					.iter<Task>("tasks")
					.find((t) => t.id.toString() === taskId);
				if (!task) error("TASK_NOT_FOUND", `Task not found: ${taskId}`);

				success(task);
				if (!isJsonMode()) {
					console.log(
						toonList("task", [
							{
								id: task.id.toString(),
								title: task.title,
								status: TaskStatus.display(task.status),
								priority: task.priority,
								assignedTo: task.assignedTo || "",
								projectId: task.projectId.toString(),
								githubIssueUrl: task.githubIssueUrl || "",
								githubPrUrl: task.githubPrUrl || "",
								description: task.description,
							},
						]),
					);
				}
				break;
			}

			case "create": {
				if (!args.project || !args.title)
					error("ARGS_REQUIRED", "--project and --title required");

				const priority = parseInt(args.priority || "5", 10);
				if (priority < 1 || priority > 10)
					error("INVALID_PRIORITY", "Priority must be 1-10");

				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "createTask", {
								projectId: BigInt(args.project as string),
								title: args.title,
								description: args.description || "",
								priority,
								sourceIdeaId: undefined,
								githubIssueUrl: args["github-issue-url"],
							});
						},
					);
					success({
						created: true,
						projectId: args.project,
						title: args.title,
						issue: args["github-issue-url"],
					});
					if (!isJsonMode()) {
						console.log(
							toonList("task_created", [
								{
									projectId: args.project,
									title: args.title,
									githubIssueUrl: args["github-issue-url"] || "",
								},
							]),
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
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
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "claimTask", { taskId: BigInt(taskId) });

							const task = ctx
								.iter<Task>("tasks")
								.find((t) => t.id.toString() === taskId);
							const project = task
								? ctx
										.iter<Project>("projects")
										.find((p) => p.id === task.projectId)
								: undefined;

							if (project?.githubRepo) {
								repositoryUrl = normalizeGitHubRepoUrl(project.githubRepo);
								if (repositoryUrl) {
									contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`;
								}
							}
						},
					);
					success({
						claimed: true,
						taskId,
						repositoryUrl,
						contributingUrl,
						nextSteps: [
							repositoryUrl
								? `Fork the target repository: ${repositoryUrl}`
								: "Fork the target repository to your GitHub account using gh cli",
							contributingUrl
								? `Read CONTRIBUTING.md before starting: ${contributingUrl}`
								: "Read CONTRIBUTING.md in the target repository before starting",
							"Verify behavior independently by tracing relevant code flow and runtime path before implementing changes.",
						],
					});

					if (!isJsonMode()) {
						console.log(
							toonList("task_claimed", [
								{
									taskId,
									repositoryUrl: repositoryUrl || "",
									contributingUrl: contributingUrl || "",
								},
							]),
						);
						console.log("");
						console.log("Next steps:");
						if (repositoryUrl) {
							console.log(`1. Fork the target repository: ${repositoryUrl}`);
						} else {
							console.log(
								"1. Fork the target repository to your GitHub account",
							);
						}
						if (contributingUrl) {
							console.log(
								`2. Read CONTRIBUTING.md before starting: ${contributingUrl}`,
							);
						} else {
							console.log(
								"2. Read CONTRIBUTING.md in the target repository before starting",
							);
						}
						console.log(
							"3. Verify behavior independently by tracing relevant code flow and runtime path before implementing changes.",
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "update": {
				const taskId = args.id;
				if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");
				if (!args.status && !args["github-pr-url"])
					error("UPDATE_REQUIRED", "--status or --github-pr-url required");

				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "updateTaskStatus", {
								taskId: BigInt(taskId),
								status: args.status
									? TaskStatus.fromString(args.status)
									: (undefined as never),
								githubPrUrl: args["github-pr-url"],
								archiveReason: undefined,
							});
						},
					);
					success({
						updated: true,
						taskId,
						status: args.status,
						pr: args["github-pr-url"],
					});
					if (!isJsonMode()) {
						console.log(
							toonList("task_updated", [
								{
									taskId,
									status: args.status || "",
									githubPrUrl: args["github-pr-url"] || "",
								},
							]),
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "review": {
				const taskId = args.id;
				if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");

				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "updateTaskStatus", {
								taskId: BigInt(taskId),
								status: { tag: "Review" },
								githubPrUrl: args["github-pr-url"],
								archiveReason: undefined,
							});
						},
					);
					success({
						reviewed: true,
						taskId,
						status: "review",
						pr: args["github-pr-url"],
					});
					if (!isJsonMode()) {
						console.log(
							toonList("task_review", [
								{
									taskId,
									status: "review",
									githubPrUrl: args["github-pr-url"] || "",
								},
							]),
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "deps": {
				const taskId = args.id;
				if (!taskId) error("TASK_ID_REQUIRED", "Task ID required");
				const taskIdBigInt = BigInt(taskId);

				if (args["add-dep"]) {
					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "addTaskDependency", {
									taskId: taskIdBigInt,
									dependsOnId: BigInt(args["add-dep"] as string),
									dependencyType: { tag: "Blocks" },
								});
							},
						);
						success({ added: true, taskId, dependsOn: args["add-dep"] });
						if (!isJsonMode()) {
							console.log(
								toonList("dependency_added", [
									{
										taskId,
										dependsOnId: args["add-dep"],
										dependencyType: "blocks",
									},
								]),
							);
						}
					} catch (err) {
						error(
							"REDUCER_FAILED",
							err instanceof Error ? err.message : "Unknown error",
						);
					}
				} else if (args.list) {
					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const deps = ctx.iter<TaskDependency>("task_dependencies");
					const taskDeps = deps.filter(
						(d) => d.taskId === taskIdBigInt || d.dependsOnId === taskIdBigInt,
					);

					success({ dependencies: taskDeps });
					if (!isJsonMode()) {
						console.log(
							toonList(
								"task_dependencies",
								taskDeps.map((dep) => ({
									id: dep.id.toString(),
									taskId: dep.taskId.toString(),
									dependsOnId: dep.dependsOnId.toString(),
									dependencyType: dep.dependencyType,
								})),
							),
						);
					}
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
					{ host: args.host, module: args.module, wallet: args.wallet },
					async (ctx) => {
						if (!isJsonMode()) {
							console.log(
								toonList("task_watch", [
									{
										timeoutSeconds: timeout,
										statusFilter: args.status || "",
									},
								]),
							);
						}

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
							if (
								!args.status ||
								TaskStatus.matches(task.status, args.status)
							) {
								console.log(
									toonList("tasks", [
										{
											id: task.id.toString(),
											title: task.title,
											change_type: "created",
										},
									]),
								);
							}
						});

						ctx.db.tasks.onUpdate((_ctx, _old, newTask) => {
							if (
								!args.status ||
								TaskStatus.matches(newTask.status, args.status)
							) {
								console.log(
									toonList("tasks", [
										{
											id: newTask.id.toString(),
											title: newTask.title,
											change_type: "updated",
										},
									]),
								);
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
		const message = err instanceof Error ? err.message : String(err);
		error("CONNECTION_ERROR", message);
	}
};
