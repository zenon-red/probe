import { defineCommand } from "citty";
import {
	CommandContext,
	callReducer,
	type Project,
	withAuth,
} from "~/utils/context.js";
import { ProjectStatus } from "~/utils/enums.js";
import { printHelp } from "~/utils/help.js";
import { error, isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

export default defineCommand({
	meta: { name: "project", description: "Project commands" },
	args: {
		action: {
			type: "positional",
			description: "Action: list, get, create, status, set-status",
			required: false,
		},
		id: { type: "positional", description: "Project ID", required: false },
		value: {
			type: "positional",
			description: "Status value for set-status: active|paused",
			required: false,
		},
		status: { type: "string", description: "Filter by status" },
		limit: { type: "string", description: "Limit projects returned" },
		name: { type: "string", description: "Project name" },
		description: { type: "string", description: "Project description" },
		"github-repo": { type: "string", description: "GitHub repository URL" },
		"source-idea": { type: "string", description: "Source idea ID" },
		wallet: { type: "string", description: "Wallet name" },
		json: { type: "boolean", description: "Output JSON", default: false },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe project",
				description: "Project listing and lookup commands",
				usage: [
					"probe project <action> [options]",
					"probe project list --status active",
					"probe project get 1",
					"probe project status 1",
					"probe project set-status 1 paused --wallet admin-wallet",
				],
				actions: [
					{ name: "list", detail: "List projects with optional status filter" },
					{ name: "get <id>", detail: "Show one project by ID" },
					{ name: "create", detail: "Create a new project" },
					{ name: "status <id>", detail: "Show only project status" },
					{
						name: "set-status <id> <active|paused>",
						detail: "Update project status (admin/zoe)",
					},
				],
				options: [
					{ name: "--status", detail: "Status filter for list: active|paused" },
					{ name: "--limit", detail: "Max projects returned for list" },
					{ name: "--name", detail: "Project name (create)" },
					{ name: "--description", detail: "Project description (create)" },
					{ name: "--github-repo", detail: "GitHub repository URL (create)" },
					{ name: "--source-idea", detail: "Source idea ID (create)" },
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: [
					"Only admin/zoe identities can call set-status.",
					"Find idea IDs with `probe idea list` before using --source-idea.",
					"Find project IDs with `probe project list` before using get/create follow-up commands.",
				],
			});
			return;
		}

		const action = args.action;

		try {
			switch (action) {
				case "list": {
					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					let projects = ctx.iter<Project>("projects");
					const limit = args.limit ? parseInt(args.limit, 10) : undefined;

					if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
						error("INVALID_LIMIT", "--limit must be a positive integer");
					}

					if (args.status)
						projects = projects.filter((p) =>
							ProjectStatus.matches(p.status, args.status as string),
						);
					projects = projects.sort((a, b) => {
						const aMicros = toMicros(a.createdAt);
						const bMicros = toMicros(b.createdAt);
						if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
						if (a.id === b.id) return 0;
						return b.id > a.id ? 1 : -1;
					});
					if (limit !== undefined) projects = projects.slice(0, limit);

					success({ projects, count: projects.length });
					if (!isJsonMode()) {
						console.log(
							toonList(
								"projects",
								projects.map((p) => ({
									id: p.id,
									name: p.name,
									status: ProjectStatus.display(p.status),
									githubRepo: p.githubRepo,
								})),
							),
						);
					}
					break;
				}

				case "get": {
					const projectId = args.id;
					if (!projectId) error("PROJECT_ID_REQUIRED", "Project ID required");

					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const project = ctx
						.iter<Project>("projects")
						.find((p) => p.id.toString() === projectId);
					if (!project)
						error("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);

					success(project);
					if (!isJsonMode()) {
						console.log(
							toonList("project", [
								{
									id: project.id.toString(),
									name: project.name,
									status: ProjectStatus.display(project.status),
									githubRepo: project.githubRepo,
									description: project.description,
								},
							]),
						);
					}
					break;
				}

				case "status": {
					const projectId = args.id;
					if (!projectId) error("PROJECT_ID_REQUIRED", "Project ID required");

					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const project = ctx
						.iter<Project>("projects")
						.find((p) => p.id.toString() === projectId);
					if (!project)
						error("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);

					const status = ProjectStatus.display(project.status);
					success({ projectId, status });
					if (!isJsonMode()) {
						console.log(
							toonList("project_status", [
								{
									id: project.id.toString(),
									name: project.name,
									status,
								},
							]),
						);
					}
					break;
				}

				case "create": {
					if (!args.name || !args["github-repo"] || !args["source-idea"]) {
						error(
							"ARGS_REQUIRED",
							"--name, --github-repo, and --source-idea required",
						);
					}

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "createProject", {
									sourceIdeaId: BigInt(args["source-idea"] as string),
									name: args.name,
									githubRepo: args["github-repo"],
									description: args.description || "",
								});
							},
						);
						success({
							created: true,
							name: args.name,
							githubRepo: args["github-repo"],
							sourceIdeaId: args["source-idea"],
						});
						if (!isJsonMode()) {
							console.log(
								toonList("project_created", [
									{
										name: args.name,
										githubRepo: args["github-repo"],
										sourceIdeaId: args["source-idea"],
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

				case "set-status": {
					const projectId = args.id;
					const nextStatus = args.value;
					if (!projectId || !nextStatus) {
						error(
							"ARGS_REQUIRED",
							"Project ID and status required. Use: probe project set-status <id> <active|paused>",
						);
					}

					const normalized = nextStatus.toLowerCase().replace(/[_\s]/g, "");
					if (!["active", "paused"].includes(normalized)) {
						error(
							"INVALID_STATUS",
							`Invalid status: ${nextStatus}. Use: active, paused`,
						);
					}

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "updateProjectStatus", {
									projectId: BigInt(projectId),
									status: ProjectStatus.fromString(nextStatus),
								});
							},
						);

						success({ updated: true, projectId, status: normalized });
						if (!isJsonMode()) {
							console.log(
								toonList("project_status_updated", [
									{
										projectId,
										status: normalized,
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

				default:
					error(
						"INVALID_ACTION",
						`Invalid action: ${action}`,
						"Use: list, get, create, status, set-status",
					);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			error("CONNECTION_ERROR", message);
		}
	},
});
