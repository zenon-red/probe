import { resolveMarkerPrefix } from "./marker-scope.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectScopedJsonlLines, findNewestFileWithMarker, forEachLineSync } from "./fs.js";
import { getNested, getNumber } from "./json.js";
import { EMPTY_USAGE, type HarnessUsage, type HarnessUsageExtraction } from "./types.js";

export const OPENCLAW_ROOT = () => join(homedir(), ".openclaw", "sessions");

export function extractOpenclawUsageExtraction(
  openclawRoot: string,
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

  if (!existsSync(openclawRoot)) {
    return { usage: EMPTY_USAGE, debugReason: "openclaw_root_missing" };
  }

  const artifact = findNewestFileWithMarker(openclawRoot, marker, runStartedAt.getTime(), (path) =>
    /\.(jsonl?|json)$/i.test(path),
  );
  if (!artifact) {
    return { usage: EMPTY_USAGE, debugReason: "openclaw_session_not_found" };
  }

  const usage = artifact.path.endsWith(".jsonl")
    ? sumOpenclawUsageFromScopedJsonl(artifact.path, marker, markerPrefix)
    : sumOpenclawUsageFromScopedJson(artifact.path, marker, markerPrefix);
  return { usage };
}

export function sumOpenclawUsageFromScopedJsonl(
  path: string,
  marker: string,
  markerPrefix: string,
): HarnessUsage {
  return sumOpenclawUsageFromJsonlLines(collectScopedJsonlLines(path, marker, markerPrefix));
}

function sumOpenclawUsageFromScopedJson(
  path: string,
  marker: string,
  markerPrefix: string,
): HarnessUsage {
  const fromJsonl = sumOpenclawUsageFromScopedJsonl(path, marker, markerPrefix);
  if (fromJsonl.inputTokens > 0 || fromJsonl.outputTokens > 0) return fromJsonl;

  let scoped = "";
  let capturing = false;
  forEachLineSync(path, (line) => {
    if (line.includes(marker)) {
      capturing = true;
      scoped += `${line}\n`;
      return;
    }
    if (capturing) {
      if (line.includes(markerPrefix)) return false;
      scoped += `${line}\n`;
    }
  });
  return scoped ? sumOpenclawUsageFromScopedText(scoped) : EMPTY_USAGE;
}

export function sumOpenclawUsageFromJsonlLines(lines: string[]): HarnessUsage {
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
    const usage =
      getNested(row, ["usage"]) ??
      getNested(row, ["message", "usage"]) ??
      getNested(row, ["result", "usage"]);
    if (!usage || typeof usage !== "object") continue;
    const input = getNumber(usage as Record<string, unknown>, "input");
    const output = getNumber(usage as Record<string, unknown>, "output");
    if (input !== null) inputTokens += input;
    if (output !== null) outputTokens += output;
  }
  return { inputTokens, outputTokens };
}

export function sumOpenclawUsageFromScopedText(scoped: string): HarnessUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  const usageBlocks = scoped.matchAll(/"usage"\s*:\s*\{[^}]*\}/g);
  for (const block of usageBlocks) {
    const inputMatch = block[0].match(/"input"\s*:\s*(\d+)/);
    const outputMatch = block[0].match(/"output"\s*:\s*(\d+)/);
    if (inputMatch) inputTokens += Number(inputMatch[1]);
    if (outputMatch) outputTokens += Number(outputMatch[1]);
  }
  return { inputTokens, outputTokens };
}
