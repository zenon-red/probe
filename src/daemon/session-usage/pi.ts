import { existsSync } from "node:fs";
import { newestFileWithMarker, sumPiJsonlUsage } from "./correlate.js";
import type { SessionUsageContext, SessionUsageResult } from "./types.js";
import { resolveSessionRoot } from "./roots.js";

export async function extractPiSessionUsage(ctx: SessionUsageContext): Promise<SessionUsageResult> {
  const root = resolveSessionRoot("pi", ctx.dataRoots);
  if (!root || !existsSync(root)) {
    return empty("pi_sessions_missing");
  }

  const path = newestFileWithMarker(root, ctx.marker, ctx.runStartedAt.getTime(), [".jsonl"]);
  if (!path) {
    return empty("pi_session_not_found");
  }

  const { inputTokens, outputTokens } = await sumPiJsonlUsage(path, ctx.marker, ctx.markerPrefix);
  return { found: true, inputTokens, outputTokens, sessionFile: path };
}

function empty(reason: string): SessionUsageResult {
  return { found: false, inputTokens: 0, outputTokens: 0, reason };
}
