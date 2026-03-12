import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import { setJsonMode } from "~/utils/output.js";
import { runTaskAction, type TaskCommandArgs } from "./task-handlers.js";

export default defineCommand({
	meta: { name: "task", description: "Task management" },
	args: {
		action: {
			type: "positional",
			description:
				"Action: list, ready, get, create, claim, update, review, deps, watch",
			required: false,
		},
		id: { type: "positional", description: "Task ID", required: false },
		status: { type: "string", description: "Status filter or new status" },
		project: { type: "string", description: "Project ID" },
		title: { type: "string", description: "Task title" },
		description: { type: "string", description: "Task description" },
		priority: { type: "string", description: "Priority 1-10" },
		assigned: {
			type: "boolean",
			description: "Show only assigned tasks",
			default: false,
		},
		wallet: { type: "string", description: "Wallet name" },
		"github-pr-url": { type: "string", description: "GitHub PR URL" },
		"github-issue-url": { type: "string", description: "GitHub issue URL" },
		"add-dep": { type: "string", description: "Add dependency task ID" },
		list: { type: "boolean", description: "List dependencies", default: false },
		timeout: { type: "string", description: "Watch timeout (seconds)" },
		limit: { type: "string", description: "Limit rows for list/ready" },
		json: { type: "boolean", description: "Output JSON", default: false },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe task",
				description: "Task management commands",
				usage: [
					"probe task <action> [options]",
					"probe task list --project 1 --status open",
					'probe task create --project 1 --title "Fix bug" --priority 5',
				],
				actions: [
					{ name: "list", detail: "List tasks with optional filters" },
					{ name: "ready", detail: "List immediately claimable open tasks" },
					{ name: "get <id>", detail: "Show one task" },
					{ name: "create", detail: "Create a new task" },
					{ name: "claim <id>", detail: "Claim a task for your identity" },
					{ name: "update <id>", detail: "Update status and optional PR URL" },
					{ name: "review <id>", detail: "Mark a task as ready for review" },
					{ name: "deps <id>", detail: "List or add task dependencies" },
					{ name: "watch", detail: "Watch task changes in real time" },
				],
				options: [
					{ name: "--project", detail: "Project ID" },
					{ name: "--title", detail: "Task title (create)" },
					{ name: "--description", detail: "Task description" },
					{ name: "--priority", detail: "Priority from 1 to 10 (default: 5)" },
					{ name: "--status", detail: "Filter or new status" },
					{ name: "--limit", detail: "Limit rows for list/ready" },
					{
						name: "--github-pr-url",
						detail: "GitHub PR URL for update/review",
					},
					{ name: "--github-issue-url", detail: "GitHub issue URL for create" },
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: [
					"Use full long-form flags only; short aliases are intentionally disabled.",
					"Find project IDs with `probe project list`; find task IDs with `probe task list`.",
				],
			});
			return;
		}

		await runTaskAction(args as TaskCommandArgs);
	},
});
