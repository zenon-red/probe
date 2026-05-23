import type { EvaluationDimension } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected, isProbeError } from "~/utils/errors.js";
import type { Idea } from "~/utils/context.js";
import { error } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";

export const SCORE_FLAGS = [
  ["ecosystem-impact", "ecosystem_impact"],
  ["implementation-readiness", "implementation_readiness"],
  ["dependency-independence", "dependency_independence"],
  ["documentation-leverage", "documentation_leverage"],
  ["maintenance-sustainability", "maintenance_sustainability"],
  ["agent-capability-fit", "agent_capability_fit"],
  ["execution-clarity", "execution_clarity"],
] as const;

export type DimensionScoreInput = { dimension: string; score: number };

export const sortIdeasNewest = (ideas: Idea[]): Idea[] => {
  return ideas.sort((a, b) => {
    const aMicros = toMicros(a.createdAt);
    const bMicros = toMicros(b.createdAt);
    if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
    if (a.id === b.id) return 0;
    return b.id > a.id ? 1 : -1;
  });
};

export async function runWithBoundary(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isProbeError(err)) throw err;
    failWithConnectionOrUnexpected(errorMessage(err));
  }
}

function normalizeScore(rawScore: unknown, label: string): number {
  const score = Number(rawScore);
  if (!Number.isInteger(score)) {
    error("INVALID_SCORES", `Score for '${label}' must be an integer`);
  }
  return score;
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
    error("INVALID_SCORES", `Dimension '${normalizedDimension}' was provided more than once`);
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
          error("INVALID_SCORES", "--score entries must use dimension=value syntax");
        }
        return [part.slice(0, separator), part.slice(separator + 1)] as [string, string];
      }),
  );
}

export function buildDimensionScores(args: Record<string, unknown>): DimensionScoreInput[] {
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
    error("ARGS_REQUIRED", "Provide dimension scores with score flags or --score dimension=value");
  }

  return [...scores.values()];
}

export function validateDimensionScores(
  scores: DimensionScoreInput[],
  dimensions: EvaluationDimension[],
): void {
  const activeDimensions = dimensions
    .filter((d) => d.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const scoreMap = new Map(scores.map((s) => [s.dimension, s.score]));

  for (const dim of activeDimensions) {
    if (!scoreMap.has(dim.name)) {
      error("MISSING_DIMENSION", `Missing score for dimension: ${dim.label || dim.name}`);
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

export const voteScoreArgs = {
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
} as const;
