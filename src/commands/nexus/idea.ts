import { defineCommand } from "citty";
import {
	CommandContext,
	callReducer,
	type Idea,
	withAuth,
} from "~/utils/context.js";
import { IdeaStatus, VoteType } from "~/utils/enums.js";
import { printHelp } from "~/utils/help.js";
import { error, isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

export default defineCommand({
	meta: { name: "idea", description: "Idea management" },
	args: {
		action: {
			type: "positional",
			description: "Action: list, propose, vote, get",
			required: false,
		},
		id: { type: "positional", description: "Idea ID", required: false },
		voteType: {
			type: "positional",
			description: "Vote type: up, down, veto",
			required: false,
		},
		title: { type: "string", description: "Idea title" },
		category: { type: "string", description: "Category" },
		description: { type: "string", description: "Description" },
		status: { type: "string", description: "Filter by status" },
		limit: { type: "string", description: "Limit ideas returned" },
		wallet: { type: "string", description: "Wallet name" },
		json: { type: "boolean", description: "Output JSON", default: false },
		host: { type: "string", description: "SpacetimeDB host" },
		module: { type: "string", description: "Module name" },
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (!args.action) {
			printHelp({
				command: "probe idea",
				description: "Idea discovery, review, and voting",
				usage: [
					"probe idea <action> [options]",
					"probe idea list --status voting",
					"probe idea vote 42 up",
				],
				actions: [
					{ name: "list", detail: "List ideas with optional filters" },
					{ name: "get <id>", detail: "Show one idea" },
					{ name: "propose", detail: "Propose a new idea" },
					{ name: "vote <id> <up|down|veto>", detail: "Vote on an idea" },
				],
				options: [
					{ name: "--title", detail: "Idea title for propose" },
					{ name: "--description", detail: "Idea description for propose" },
					{ name: "--category", detail: "Idea category for propose/list" },
					{ name: "--status", detail: "Status filter for list" },
					{ name: "--limit", detail: "Max ideas returned for list" },
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: ["Find idea IDs with `probe idea list` before using get/vote."],
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
					let ideas = ctx.iter<Idea>("ideas");
					const limit = args.limit ? parseInt(args.limit, 10) : undefined;

					if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
						error("INVALID_LIMIT", "--limit must be a positive integer");
					}

					if (args.status)
						ideas = ideas.filter((i) =>
							IdeaStatus.matches(i.status, args.status),
						);
					if (args.category)
						ideas = ideas.filter((i) => i.category === args.category);
					ideas = ideas.sort((a, b) => {
						const aMicros = toMicros(a.createdAt);
						const bMicros = toMicros(b.createdAt);
						if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
						if (a.id === b.id) return 0;
						return b.id > a.id ? 1 : -1;
					});
					if (limit !== undefined) ideas = ideas.slice(0, limit);

					success({ ideas, count: ideas.length });
					if (!isJsonMode()) {
						console.log(
							toonList(
								"ideas",
								ideas.map((i) => ({
									id: i.id.toString(),
									title: i.title,
									category: i.category,
									status: IdeaStatus.display(i.status),
									votes: `${i.totalVotes}/${i.quorum}`,
									up: i.upVotes,
									veto: i.vetoCount,
								})),
							),
						);
					}
					break;
				}

				case "get": {
					const ideaId = args.id;
					if (!ideaId) error("IDEA_ID_REQUIRED", "Idea ID required");

					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const idea = ctx
						.iter<Idea>("ideas")
						.find((i) => i.id.toString() === ideaId);
					if (!idea) error("IDEA_NOT_FOUND", `Idea not found: ${ideaId}`);

					success(idea);
					if (!isJsonMode()) {
						console.log(
							toonList("idea", [
								{
									id: idea.id.toString(),
									title: idea.title,
									category: idea.category,
									status: IdeaStatus.display(idea.status),
									totalVotes: idea.totalVotes,
									quorum: idea.quorum,
									upVotes: idea.upVotes,
									downVotes: idea.downVotes,
									vetoCount: idea.vetoCount,
									approvalThreshold: idea.approvalThreshold,
									vetoThreshold: idea.vetoThreshold,
									description: idea.description,
								},
							]),
						);
					}
					break;
				}

				case "propose": {
					if (!args.title) error("ARGS_REQUIRED", "Title required");

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "proposeIdea", {
									title: args.title,
									description: args.description || "",
									category: args.category || "general",
								});
							},
						);
						success({ proposed: true, title: args.title });
						if (!isJsonMode()) {
							console.log(
								toonList("idea_proposed", [
									{
										title: args.title,
										category: args.category || "general",
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

				case "vote": {
					const ideaId = args.id;
					const voteType = args.voteType;
					if (!ideaId || !voteType)
						error("ARGS_REQUIRED", "Idea ID and vote type required");
					if (!["up", "down", "veto"].includes(voteType.toLowerCase())) {
						error("INVALID_VOTE_TYPE", "Vote type must be: up, down, veto");
					}

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								await callReducer(ctx, "voteIdea", {
									ideaId: BigInt(ideaId),
									voteType: VoteType.fromString(voteType),
								});
							},
						);
						success({ voted: true, ideaId, voteType });
						if (!isJsonMode()) {
							console.log(
								toonList("idea_voted", [
									{
										ideaId,
										voteType,
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
						"Use: list, propose, vote, get",
					);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			error("CONNECTION_ERROR", message);
		}
	},
});
