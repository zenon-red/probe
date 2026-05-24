import type { HarnessType } from "~/types/config.js";
import { actionCorrelationFlag } from "~/utils/action-prompts.js";
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
};

export function extractUsage(input: ExtractUsageInput): HarnessUsageExtraction {
  return extractHarnessUsageExtraction(input.harness, input.actionId, input.runStartedAt);
}

export function extractHarnessUsage(
  harness: HarnessType,
  actionId: bigint | number,
  runStartedAt: Date,
): HarnessUsage {
  return extractHarnessUsageExtraction(harness, actionId, runStartedAt).usage;
}

export function extractHarnessUsageExtraction(
  harness: HarnessType,
  actionId: bigint | number,
  runStartedAt: Date,
): HarnessUsageExtraction {
  const marker = actionCorrelationFlag(actionId);
  try {
    switch (harness) {
      case "pi":
        return extractPiUsageExtraction(PI_ROOT(), marker, runStartedAt);
      case "hermes":
        return extractHermesUsageExtraction(HERMES_ROOT(), marker, runStartedAt);
      case "opencode":
        return extractOpencodeUsageExtraction(marker, runStartedAt);
      case "openclaw":
        return extractOpenclawUsageExtraction(OPENCLAW_ROOT(), marker, runStartedAt);
      default:
        return { usage: EMPTY_USAGE };
    }
  } catch {
    return { usage: EMPTY_USAGE, debugReason: "extraction_error" };
  }
}
