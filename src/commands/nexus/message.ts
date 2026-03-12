import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import { setJsonMode } from "~/utils/output.js";
import {
	type MessageCommandArgs,
	runMessageAction,
} from "./message-handlers.js";

export default defineCommand({
	meta: { name: "message", description: "Message management" },
	args: {
		action: {
			type: "positional",
			description: "Action: list, send, directive, directives, channels",
			required: false,
		},
		target: {
			type: "positional",
			description: "Channel name, project ID, or message content",
			required: false,
		},
		content: {
			type: "positional",
			description: "Message content (if target is channel/project)",
			required: false,
		},
		type: {
			type: "string",
			description: "Message type: user, system",
			default: "user",
		},
		context: {
			type: "string",
			description: "Thread context ID (message ID or entity ref like task:42)",
		},
		limit: { type: "string", description: "Limit messages", default: "20" },
		wallet: { type: "string", description: "Wallet name" },
		json: { type: "boolean", description: "Output JSON", default: false },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe message",
				description: "Channel and project messaging commands",
				usage: [
					"probe message <action> [target] [content] [options]",
					"probe message list --limit 50",
					'probe message send general "hello team"',
					'probe message directive zoe "Focus on project stability" --context project:1',
				],
				actions: [
					{
						name: "list [target]",
						detail: "List user messages (all, channel, or project)",
					},
					{
						name: "directives [target]",
						detail: "List directive messages (all, channel, or project)",
					},
					{
						name: "send <target> <content>",
						detail: "Send to target channel/project",
					},
					{
						name: "directive <target> <content>",
						detail: "Send directive to target channel/project",
					},
					{ name: "channels", detail: "List channels and project channels" },
				],
				options: [
					{
						name: "--type",
						detail: "Message type: user, system (default: user)",
					},
					{
						name: "--context",
						detail: "Optional thread context ID (message ID or entity ref)",
					},
					{
						name: "--limit",
						detail: "Max messages returned for list (default: 20)",
					},
					{ name: "--wallet", detail: "Wallet to use for send" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				examples: [
					"probe message send general hello",
					'probe message directive zoe "Pause new work" --context project:1',
					"probe message directives zoe --limit 1",
					'probe message send zoe "hello there"',
					'probe message send zoe "reviewed" --context 123',
					'probe message send 1 "project update"',
					"probe message list zoe --limit 10",
				],
				notes: [
					"Quotes are only required when target/content contains spaces.",
					"Use `probe message channels` to discover available channel names and project IDs.",
				],
			});
			return;
		}

		await runMessageAction(args as MessageCommandArgs);
	},
});
