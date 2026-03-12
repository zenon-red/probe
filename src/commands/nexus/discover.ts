import { defineCommand } from "citty";
import {
	CommandContext,
	callReducer,
	type DiscoveredTask,
	withAuth,
} from "~/utils/context.js";
import { printHelp } from "~/utils/help.js";
import { error, isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { formatTimestamp, toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

const toDiscoveryDecision = (input: string) => {
	const value = input.toLowerCase();
	if (value === "approve") return { tag: "ApproveAsTask" };
	if (value === "reject") return { tag: "Reject" };
	if (value === "escalate_to_idea") return { tag: "EscalateToIdea" };
	return null;
};

const discoveryStatusTag = (status: unknown): string => {
	if (status && typeof status === "object" && "tag" in status) {
		return String((status as { tag: string }).tag);
	}
	return String(status);
};

const discoveryStatusDisplay = (status: unknown): string => {
	const tag = discoveryStatusTag(status);
	const map: Record<string, string> = {
		PendingReview: "pending_review",
		Approved: "approved",
		Rejected: "rejected",
		EscalatedToIdea: "escalated_to_idea",
	};
	return map[tag] ?? tag;
};

export default defineCommand({
	meta: { name: "discover", description: "Discovered task management" },
	args: {
		action: {
			type: "positional",
			description: "Action: report, review, list, get",
			required: false,
		},
		id: {
			type: "positional",
			description: "Discovered task ID",
			required: false,
		},
		decision: {
			type: "positional",
			description: "Decision: approve, reject, escalate_to_idea",
			required: false,
		},
		task: { type: "string", description: "Current task ID" },
		project: { type: "string", description: "Project ID" },
		title: { type: "string", description: "Task title" },
		type: {
			type: "string",
			description: "Task type: bug, improvement, feature",
		},
		severity: {
			type: "string",
			description: "Severity: low, medium, high, critical",
		},
		status: { type: "string", description: "Filter by status" },
		limit: { type: "string", description: "Limit discovered tasks returned" },
		description: { type: "string", description: "Description" },
		reason: { type: "string", description: "Rejection reason" },
		wallet: { type: "string", description: "Wallet name" },
		json: { type: "boolean", description: "Output JSON", default: false },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe discover",
				description: "Discovered task reporting and review",
				usage: [
					"probe discover <action> [options]",
					'probe discover report --task 12 --project 1 --title "Fix parse"',
					"probe discover review 9 approve",
				],
				actions: [
					{
						name: "report",
						detail: "Report a discovered task from current work",
					},
					{
						name: "review <id> <approve|reject|escalate_to_idea>",
						detail: "Approve, reject, or escalate discovery",
					},
					{ name: "list", detail: "List discovered tasks" },
					{ name: "get <id>", detail: "Show one discovered task" },
				],
				options: [
					{ name: "--task, --project, --title", detail: "Required for report" },
					{ name: "--type", detail: "Task type: bug, improvement, feature" },
					{
						name: "--severity",
						detail: "Severity: low, medium, high, critical",
					},
					{ name: "--reason", detail: "Reason for rejection/escalation" },
					{ name: "--limit", detail: "Max discovered tasks returned for list" },
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: [
					"Find current task IDs with `probe task list` and project IDs with `probe project list`.",
				],
			});
			return;
		}

		const action = args.action;

		try {
			switch (action) {
				case "report": {
					if (!args.task || !args.project || !args.title) {
						error("ARGS_REQUIRED", "--task, --project, and --title required");
					}

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "discoverTask", {
									currentTaskId: BigInt(args.task),
									projectId: BigInt(args.project),
									title: args.title,
									description: args.description || "",
									priority: 5,
									taskType: args.type || "improvement",
									severity: args.severity || "medium",
								});
							},
						);
						success({ reported: true, title: args.title });
						if (!isJsonMode()) {
							console.log(
								toonList("discovery_reported", [
									{
										title: args.title,
										taskId: args.task,
										projectId: args.project,
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
					const discId = args.id;
					const decisionInput = args.decision;
					if (!discId || !decisionInput)
						error("ARGS_REQUIRED", "ID and decision required");

					const decision = decisionInput.toLowerCase();

					const validDecisions = ["approve", "reject", "escalate_to_idea"];
					if (!validDecisions.includes(decision)) {
						error(
							"INVALID_DECISION",
							`Invalid decision: ${decisionInput}. Use: ${validDecisions.join(", ")}`,
						);
					}

					const decisionValue = toDiscoveryDecision(decision);
					if (!decisionValue) {
						error(
							"INVALID_DECISION",
							`Invalid decision: ${decisionInput}. Use: ${validDecisions.join(", ")}`,
						);
					}

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "reviewDiscoveredTask", {
									discoveryId: BigInt(discId),
									decision: decisionValue,
									reason: args.reason || undefined,
								});
							},
						);
						success({ reviewed: true, id: discId, decision });
						if (!isJsonMode()) {
							console.log(
								toonList("discovery_reviewed", [
									{
										id: discId,
										decision,
										reason: args.reason || "",
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

				case "list": {
					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					let discovered = ctx.iter<DiscoveredTask>("discovered_tasks");
					const limit = args.limit ? parseInt(args.limit, 10) : undefined;

					if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
						error("INVALID_LIMIT", "--limit must be a positive integer");
					}

					if (args.status) {
						const filter = args.status.toLowerCase().replace(/[_\s]/g, "");
						discovered = discovered.filter(
							(d) =>
								discoveryStatusDisplay(d.status).replace(/[_\s]/g, "") ===
								filter,
						);
					}
					discovered = discovered.sort((a, b) => {
						const aMicros = toMicros(a.createdAt);
						const bMicros = toMicros(b.createdAt);
						if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
						if (a.id === b.id) return 0;
						return b.id > a.id ? 1 : -1;
					});
					if (limit !== undefined) discovered = discovered.slice(0, limit);

					success({ discoveredTasks: discovered, count: discovered.length });
					if (!isJsonMode()) {
						console.log(
							toonList(
								"discovered_tasks",
								discovered.map((d) => ({
									id: d.id.toString(),
									title: d.title,
									taskType: d.taskType,
									severity: d.severity,
									status: discoveryStatusDisplay(d.status),
									projectId: d.projectId,
								})),
							),
						);
					}
					break;
				}

				case "get": {
					const discoveryId = args.id;
					if (!discoveryId)
						error("DISCOVERY_ID_REQUIRED", "Discovery ID required");

					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const discovery = ctx
						.iter<DiscoveredTask>("discovered_tasks")
						.find((d) => d.id.toString() === discoveryId);
					if (!discovery)
						error("DISCOVERY_NOT_FOUND", `Discovery not found: ${discoveryId}`);

					success(discovery);
					if (!isJsonMode()) {
						console.log(
							toonList("discovered_task", [
								{
									id: discovery.id.toString(),
									title: discovery.title,
									status: discoveryStatusDisplay(discovery.status),
									taskType: discovery.taskType,
									severity: discovery.severity,
									priority: discovery.priority,
									projectId: discovery.projectId.toString(),
									currentTaskId: discovery.currentTaskId.toString(),
									description: discovery.description,
									reviewedBy: discovery.reviewedBy || "",
									reviewedAt: discovery.reviewedAt
										? formatTimestamp(discovery.reviewedAt)
										: "",
									rejectionReason: discovery.rejectionReason || "",
									createdTaskId: discovery.createdTaskId
										? discovery.createdTaskId.toString()
										: "",
								},
							]),
						);
					}
					break;
				}

				default:
					error(
						"INVALID_ACTION",
						`Invalid action: ${action}`,
						"Use: report, review, list, get",
					);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			error("CONNECTION_ERROR", message);
		}
	},
});
