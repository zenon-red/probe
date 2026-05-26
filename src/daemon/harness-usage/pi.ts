import { resolveMarkerPrefix } from "./marker-scope.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectScopedJsonlLines, findNewestJsonlWithMarker } from "./fs.js";
import { getNested, getNumber } from "./json.js";
import { EMPTY_USAGE, type HarnessUsage, type HarnessUsageExtraction } from "./types.js";

export const PI_ROOT = () => join(homedir(), ".pi", "agent", "sessions");

export function extractPiUsageExtraction(
  piRoot: string,
  marker: string,
  markerPrefixOrRunStartedAt: string | Date,
  runStartedAtMaybe?: Date,
): HarnessUsageExtraction {
  const markerPrefix =
    typeof markerPrefixOrRunStartedAt === "string"
      ? markerPrefixOrRunStartedAt
      : resolveMarkerPrefix();
  const runStartedAt =
    markerPrefixOrRunStartedAt instanceof Date ? markerPrefixOrRunStartedAt : runStartedAtMaybe;
  if (!runStartedAt) {
    return { usage: EMPTY_USAGE, debugReason: "run_started_at_missing" };
  }

  if (!existsSync(piRoot)) {
    return { usage: EMPTY_USAGE, debugReason: "pi_root_missing" };
  }

  const sessionPath = findNewestJsonlWithMarker(piRoot, marker, runStartedAt.getTime());
  if (!sessionPath) {
    return { usage: EMPTY_USAGE, debugReason: "pi_session_not_found" };
  }

  return { usage: sumPiUsageFromScopedJsonl(sessionPath, marker, markerPrefix) };
}

function sumPiUsageFromScopedJsonl(
  path: string,
  marker: string,
  markerPrefix: string,
): HarnessUsage {
  return sumPiUsageFromLines(collectScopedJsonlLines(path, marker, markerPrefix));
}

export function sumPiUsageFromLines(lines: string[]): HarnessUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const role = getNested(row, ["message", "role"]);
    if (role !== undefined && role !== "assistant") continue;
    const usage = getNested(row, ["message", "usage"]);
    if (!usage || typeof usage !== "object") continue;
    const input = getNumber(usage as Record<string, unknown>, "input");
    const output = getNumber(usage as Record<string, unknown>, "output");
    if (input !== null) inputTokens += input;
    if (output !== null) outputTokens += output;
  }
  return { inputTokens, outputTokens };
}
