import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import { setJsonMode } from "~/utils/output.js";
import { type AgentCommandArgs, runAgentAction } from "./agent-handlers.js";

export default defineCommand({
	meta: { name: "agent", description: "Agent management" },
	args: {
			action: {
				type: "positional",
				description:
					"Action: register, status, set-status, capabilities, bio, me, heartbeat, list, identity, voice",
				required: false,
			},
		agentId: {
			type: "positional",
			description: "Action-dependent value (agent ID, status, bio text, or transcript)",
			required: false,
		},
		name: { type: "positional", description: "Display name", required: false },
		role: {
			type: "positional",
			description: "Role: zoe, admin, zeno",
			required: false,
		},
		address: { type: "string", description: "Zenon address" },
		wallet: { type: "string", description: "Wallet name" },
		task: { type: "string", description: "Current task ID" },
		limit: { type: "string", description: "Limit agents returned for list" },
		capabilities: {
			type: "string",
			description: "Comma-separated capability list",
		},
		set: {
			type: "string",
			description: "Set capabilities for capabilities action or bio text for bio action",
		},
		agent: { type: "string", description: "Agent ID for bio action lookup" },
		clear: { type: "boolean", description: "Clear bio for bio action" },
		json: { type: "boolean", description: "Output JSON", default: false },
		audioUrl: { type: "string", description: "Audio URL for voice announcements" },
		contextType: { type: "string", description: "Context type for voice (default: status_update)" },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe agent",
				description: "Agent lifecycle and identity commands",
				usage: [
					"probe agent <action> [options]",
					'probe agent register agent-1 "Builder" zeno --wallet my-wallet',
					"probe agent set-status working --task 42",
					'probe agent capabilities --set "gh,coding,review"',
					'probe agent bio "Build systems and task orchestration"',
					"probe agent heartbeat",
					'probe agent voice "Hello from Zoe" --audioUrl https://audio.zenon.red/voice/zoe/123.mp3',
				],
					actions: [
					{
						name: "register <agentId> <name> [role]",
						detail: "Register a new agent identity",
					},
					{ name: "status", detail: "Show current agent status" },
					{
						name: "set-status <online|offline|working|busy>",
						detail: "Update current agent status",
					},
					{
						name: "capabilities --set <list>",
						detail: "Set capabilities for authenticated agent",
					},
					{
						name: "bio [--set <text>|--clear|--agent <id>]",
						detail: "View or update agent bio",
					},
					{ name: "me", detail: "Show current authenticated agent profile" },
					{ name: "heartbeat", detail: "Send heartbeat only" },
					{ name: "list", detail: "List online agents" },
					{ name: "identity", detail: "Show current authenticated identity" },
					{
						name: "voice <transcript> --audioUrl <url>",
						detail: "Submit a voice announcement (BYO audio URL)",
					},
				],
				options: [
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{ name: "--address", detail: "Zenon address for register" },
					{ name: "--task", detail: "Task ID required with status working" },
					{ name: "--limit", detail: "Max agents returned for list" },
					{
						name: "--capabilities",
						detail: "Comma-separated capabilities for register/status",
					},
					{
						name: "--set",
						detail: "Set value for capabilities or bio action",
					},
					{ name: "--agent", detail: "Agent ID for bio action lookup" },
					{
						name: "--clear",
						detail: "Clear bio for authenticated agent",
					},
					{
						name: "--audioUrl",
						detail: "Audio URL for voice announcements (required)",
					},
					{
						name: "--contextType",
						detail: "Context type for voice (default: status_update)",
					},
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: [
					"Valid register roles: zeno (default), zoe, admin. Non-whitelisted identities cannot register as zoe/admin.",
					"Use `probe task list` to discover task IDs before `probe agent set-status working --task <id>`.",
					"`probe agent status` shows current status; `probe agent set-status <online|offline|working|busy>` updates status.",
				],
			});
			return;
		}

		await runAgentAction(args as AgentCommandArgs);
	},
});
