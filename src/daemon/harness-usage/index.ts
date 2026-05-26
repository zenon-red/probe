import type { HarnessType } from "~/types/config.js";
import { actionCorrelationFlag } from "~/utils/action-prompts.js";
import { resolveMarkerPrefix } from "./marker-scope.js";
import { extractHermesUsageExtraction, HERMES_ROOT } from "./hermes.js";
import { extractOpencodeUsageExtraction } from "./opencode.js";
import { extractOpenclawUsageExtraction, OPENCLAW_ROOT } from "./openclaw.js";
import { extractPiUsageExtraction, PI_ROOT } from "./pi.js";
import { EMPTY_USAGE, type HarnessUsage, type HarnessUsageExtraction } from "./types.js";

export type { HarnessUsage, HarnessUsageExtraction } from "./types.js";
export type { OpencodeExtractionOptions } from "./opencode.js";
export { scopeJsonlLines, scopeTextByMarker } from "./marker-scope.js";
export { sumPiUsageFromLines, extractPiUsageExtraction } from "./pi.js";
export { sumOpencodeUsageFromObject, extractOpencodeUsageExtraction } from "./opencode.js";
export {
  sumOpenclawUsageFromJsonlLines,
  sumOpenclawUsageFromScopedText,
  extractOpenclawUsageExtraction,
} from "./openclaw.js";
export { extractHermesUsageExtraction } from "./hermes.js";

export type ExtractUsageInput = {
  harness: HarnessType;
  actionId: bigint | number;
  runStartedAt: Date;
  promptMarkerTemplate?: string;
};

export function extractUsage(input: ExtractUsageInput): HarnessUsageExtraction {
  return extractHarnessUsageExtraction(
    input.harness,
    input.actionId,
    input.runStartedAt,
    input.promptMarkerTemplate,
  );
}

export function extractHarnessUsage(
  harness: HarnessType,
  actionId: bigint | number,
  runStartedAt: Date,
  promptMarkerTemplate?: string,
): HarnessUsage {
  return extractHarnessUsageExtraction(harness, actionId, runStartedAt, promptMarkerTemplate).usage;
}

export function extractHarnessUsageExtraction(
  harness: HarnessType,
  actionId: bigint | number,
  runStartedAt: Date,
  promptMarkerTemplate?: string,
): HarnessUsageExtraction {
  const marker = actionCorrelationFlag(actionId, promptMarkerTemplate);
  const markerPrefix = resolveMarkerPrefix(promptMarkerTemplate);
  try {
    switch (harness) {
      case "pi":
        return extractPiUsageExtraction(PI_ROOT(), marker, markerPrefix, runStartedAt);
      case "hermes":
        return extractHermesUsageExtraction(HERMES_ROOT(), marker, markerPrefix, runStartedAt);
      case "opencode":
        return extractOpencodeUsageExtraction(marker, markerPrefix, runStartedAt);
      case "openclaw":
        return extractOpenclawUsageExtraction(OPENCLAW_ROOT(), marker, markerPrefix, runStartedAt);
      default:
        return { usage: EMPTY_USAGE };
    }
  } catch {
    return { usage: EMPTY_USAGE, debugReason: "extraction_error" };
  }
}
