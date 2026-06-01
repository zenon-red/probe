import type { HarnessType } from "~/types/config.js";
import { actionCorrelationFlag } from "~/utils/action-prompts.js";
import { promptMarkerPrefix } from "~/utils/prompt-marker.js";
import {
  SESSION_SHIM_HARNESSES,
  type SessionUsageContext,
  type SessionUsageResult,
} from "./types.js";

export type ExtractHarnessUsageOptions = {
  markerTemplate?: string;
  dataRoots?: Partial<Record<HarnessType, string>>;
};

export async function extractHarnessUsage(
  harness: HarnessType,
  actionId: bigint,
  runStartedAt: Date,
  options?: ExtractHarnessUsageOptions,
): Promise<SessionUsageResult> {
  if (!SESSION_SHIM_HARNESSES.has(harness)) {
    return { found: false, inputTokens: 0, outputTokens: 0, reason: "no_session_shim" };
  }

  const marker = actionCorrelationFlag(actionId, options?.markerTemplate);
  const markerPrefix = promptMarkerPrefix(options?.markerTemplate);

  const ctx: SessionUsageContext = {
    harness,
    runStartedAt,
    marker,
    markerPrefix,
    dataRoots: options?.dataRoots,
  };

  switch (harness) {
    case "pi": {
      const { extractPiSessionUsage } = await import("./pi.js");
      return extractPiSessionUsage(ctx);
    }
    case "hermes": {
      const { extractHermesSessionUsage } = await import("./hermes.js");
      return extractHermesSessionUsage(ctx);
    }
    case "opencode": {
      const { extractOpencodeSessionUsage } = await import("./opencode.js");
      return extractOpencodeSessionUsage(ctx);
    }
    case "openclaw": {
      const { extractOpenclawSessionUsage } = await import("./openclaw.js");
      return extractOpenclawSessionUsage(ctx);
    }
    default:
      return { found: false, inputTokens: 0, outputTokens: 0, reason: "unsupported_harness" };
  }
}
