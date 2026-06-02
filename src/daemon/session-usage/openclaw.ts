import { existsSync } from "node:fs";
import { newestFileWithMarker, sumScopedJsonlUsage } from "./correlate.js";
import type { SessionUsageContext, SessionUsageResult } from "./types.js";
import { resolveSessionRoot } from "./roots.js";

export function extractOpenclawSessionUsage(ctx: SessionUsageContext): SessionUsageResult {
  const root = resolveSessionRoot("openclaw", ctx.dataRoots);
  if (!root || !existsSync(root)) {
    return empty("openclaw_sessions_missing");
  }

  const path = newestFileWithMarker(root, ctx.marker, ctx.runStartedAt.getTime(), [
    ".jsonl",
    ".json",
  ]);
  if (!path) {
    return empty("openclaw_session_not_found");
  }

  const { inputTokens, outputTokens } = sumScopedJsonlUsage(path, ctx.marker, ctx.markerPrefix);
  return { found: true, inputTokens, outputTokens, sessionFile: path };
}

function empty(reason: string): SessionUsageResult {
  return { found: false, inputTokens: 0, outputTokens: 0, reason };
}
