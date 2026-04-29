import { defineCommand } from "citty";
import {
	CommandContext,
	callReducer,
	type EvaluationDimension,
	type Idea,
	withAuth,
} from "~/utils/context.js";
import { IdeaStatus } from "~/utils/enums.js";
import { printHelp } from "~/utils/help.js";
import { error, isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

const SCORE_FLAGS = [
	["ecosystem-impact", "ecosystem_impact"],
	["implementation-readiness", "implementation_readiness"],
	["dependency-independence", "dependency_independence"],
	["documentation-leverage", "documentation_leverage"],
	["maintenance-sustainability", "maintenance_sustainability"],
	["agent-capability-fit", "agent_capability_fit"],
	["execution-clarity", "execution_clarity"],
] as const;

type DimensionScoreInput = { dimension: string; score: number };

function normalizeScore(rawScore: unknown, label: string): number {
	const score = Number(rawScore);
	if (!Number.isInteger(score)) {
		error("INVALID_SCORES", `Score for '${label}' must be an integer`);
	}
	return score;
}

function validateDimensionScores(
	scores: DimensionScoreInput[],
	dimensions: EvaluationDimension[],
): void {
	const activeDimensions = dimensions
		.filter((d) => d.active)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	const scoreMap = new Map(scores.map((s) => [s.dimension, s.score]));

	for (const dim of activeDimensions) {
		if (!scoreMap.has(dim.name)) {
			error(
				"MISSING_DIMENSION",
				`Missing score for dimension: ${dim.label || dim.name}`,
			);
		}
		const score = scoreMap.get(dim.name)!;
		if (score < dim.minScore || score > dim.maxScore) {
			error(
				"INVALID_SCORE",
				`Score for '${dim.name}' must be between ${dim.minScore} and ${dim.maxScore}`,
			);
		}
	}

	const activeNames = new Set(activeDimensions.map((d) => d.name));
	for (const score of scores) {
		if (!activeNames.has(score.dimension)) {
			error("UNKNOWN_DIMENSION", `Unknown dimension: ${score.dimension}`);
		}
	}
}

function addScore(
	scores: Map<string, DimensionScoreInput>,
	dimension: string,
	rawScore: unknown,
): void {
	const normalizedDimension = dimension.trim().replaceAll("-", "_");
	if (!normalizedDimension) {
		error("INVALID_SCORES", "Dimension names cannot be empty");
	}
	if (scores.has(normalizedDimension)) {
		error(
			"INVALID_SCORES",
			`Dimension '${normalizedDimension}' was provided more than once`,
		);
	}
	scores.set(normalizedDimension, {
		dimension: normalizedDimension,
		score: normalizeScore(rawScore, normalizedDimension),
	});
}

function parseScorePairs(rawValue: unknown): Array<[string, string]> {
	if (rawValue === undefined) return [];
	const values = Array.isArray(rawValue) ? rawValue : [rawValue];
	return values.flatMap((value) =>
		String(value)
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const separator = part.indexOf("=");
				if (separator <= 0 || separator === part.length - 1) {
					error(
						"INVALID_SCORES",
						"--score entries must use dimension=value syntax",
					);
				}
				return [part.slice(0, separator), part.slice(separator + 1)] as [
					string,
					string,
				];
			}),
	);
}

function buildDimensionScores(args: Record<string, unknown>): DimensionScoreInput[] {
	const scores = new Map<string, DimensionScoreInput>();

	for (const [flag, dimension] of SCORE_FLAGS) {
		if (args[flag] !== undefined) {
			addScore(scores, dimension, args[flag]);
		}
	}

	for (const [dimension, rawScore] of parseScorePairs(args.score)) {
		addScore(scores, dimension, rawScore);
	}

	if (scores.size === 0) {
		error(
			"ARGS_REQUIRED",
			"Provide dimension scores with score flags or --score dimension=value",
		);
	}

	return [...scores.values()];
}

export default defineCommand({
	meta: { name: "idea", description: "Idea management" },
	args: {
		action: {
			type: "positional",
			description: "Action: list, propose, vote, get, dimensions",
			required: false,
		},
		id: { type: "positional", description: "Idea ID", required: false },
		title: { type: "string", description: "Idea title" },
		category: { type: "string", description: "Category" },
		description: { type: "string", description: "Description" },
		status: { type: "string", description: "Filter by status" },
		limit: { type: "string", description: "Limit ideas returned" },
		"ecosystem-impact": { type: "string", description: "Ecosystem Impact score" },
		"implementation-readiness": {
			type: "string",
			description: "Implementation Readiness score",
		},
		"dependency-independence": {
			type: "string",
			description: "Dependency Independence score",
		},
		"documentation-leverage": {
			type: "string",
			description: "Documentation Leverage score",
		},
		"maintenance-sustainability": {
			type: "string",
			description: "Maintenance Sustainability score",
		},
		"agent-capability-fit": {
			type: "string",
			description: "Agent Capability Fit score",
		},
		"execution-clarity": { type: "string", description: "Execution Clarity score" },
		score: {
			type: "string",
			description: "Additional dimension score as name=value; repeatable",
			multiple: true,
		},
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
					"probe idea dimensions",
					"probe idea vote 42 --ecosystem-impact 8 --execution-clarity 9 --implementation-readiness 7",
				],
				actions: [
					{ name: "list", detail: "List ideas with optional filters" },
					{ name: "get <id>", detail: "Show one idea" },
					{ name: "dimensions", detail: "List active evaluation dimensions" },
					{ name: "propose", detail: "Propose a new idea" },
					{ name: "vote <id>", detail: "Vote on an idea with dimension scores" },
				],
				options: [
					{ name: "--title", detail: "Idea title for propose" },
					{ name: "--description", detail: "Idea description for propose" },
					{ name: "--category", detail: "Idea category for propose/list" },
					{ name: "--ecosystem-impact", detail: "Ecosystem impact score" },
					{
						name: "--implementation-readiness",
						detail: "Implementation readiness score",
					},
					{
						name: "--dependency-independence",
						detail: "Dependency independence score",
					},
					{
						name: "--documentation-leverage",
						detail: "Documentation leverage score",
					},
					{
						name: "--maintenance-sustainability",
						detail: "Maintenance sustainability score",
					},
					{
						name: "--agent-capability-fit",
						detail: "Agent capability fit score",
					},
					{ name: "--execution-clarity", detail: "Execution clarity score" },
					{ name: "--score", detail: "Additional dimension score as name=value; repeatable" },
					{ name: "--status", detail: "Status filter for list" },
					{ name: "--limit", detail: "Max ideas returned for list" },
					{ name: "--wallet", detail: "Wallet to use for authenticated calls" },
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
				],
				notes: [
					"Find idea IDs with `probe idea list` before using get/vote.",
					"Use `probe idea dimensions` to list active score dimensions.",
					"All active dimensions are required. Use explicit flags for default dimensions and repeatable --score name=value for custom dimensions.",
					"If a missing-dimension error names a dimension without a dedicated flag, use --score and consider updating Probe.",
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
									computedScore: idea.computedScore,
									description: idea.description,
								},
							]),
						);
					}
					break;
				}

				case "dimensions": {
					await using ctx = await CommandContext.create({
						host: args.host,
						module: args.module,
					});
					const dimensions = ctx
						.iter<EvaluationDimension>("evaluation_dimensions")
						.filter((dimension) => dimension.active)
						.sort((a, b) => a.sortOrder - b.sortOrder);

					success({ dimensions, count: dimensions.length });
					if (!isJsonMode()) {
						console.log(
							toonList(
								"evaluation_dimensions",
								dimensions.map((dimension) => ({
									name: dimension.name,
									label: dimension.label,
									weight: dimension.weight,
									range: `${dimension.minScore}-${dimension.maxScore}`,
									description: dimension.description,
								})),
							),
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
					if (!ideaId) error("ARGS_REQUIRED", "Idea ID required");
					const dimensionScores = buildDimensionScores(args);

					try {
						await withAuth(
							{ host: args.host, module: args.module, wallet: args.wallet },
							async (ctx) => {
								const activeDimensions = ctx.iter<EvaluationDimension>(
									"evaluation_dimensions",
								);
								validateDimensionScores(dimensionScores, activeDimensions);

								await callReducer(ctx, "voteIdea", {
									ideaId: BigInt(ideaId),
									scores: dimensionScores,
								});
							},
						);
						success({ voted: true, ideaId, scores: dimensionScores });
						if (!isJsonMode()) {
							console.log(
								toonList("idea_voted", [
									{
										ideaId,
										scores: JSON.stringify(dimensionScores),
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
						"Use: list, propose, vote, get, dimensions",
					);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			error("CONNECTION_ERROR", message);
		}
	},
});
