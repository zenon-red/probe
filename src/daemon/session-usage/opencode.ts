import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newestFileWithMarker } from "./correlate.js";
import type { SessionUsageContext, SessionUsageResult } from "./types.js";
import { resolveSessionRoot } from "./roots.js";

export function extractOpencodeSessionUsage(ctx: SessionUsageContext): SessionUsageResult {
  const storage = resolveSessionRoot("opencode", ctx.dataRoots);
  if (!storage || !existsSync(storage)) {
    return empty("opencode_storage_missing");
  }

  const messageDir = join(storage, "session", "message");
  const sessionPath = newestFileWithMarker(messageDir, ctx.marker, ctx.runStartedAt.getTime(), [
    ".json",
  ]);
  if (!sessionPath) {
    return empty("opencode_session_not_found");
  }

  const parts = sessionPath.split("/");
  const sessionId = parts[parts.length - 2];
  const sessionMessageDir = join(messageDir, sessionId);
  if (!existsSync(sessionMessageDir)) {
    return empty("opencode_message_dir_missing");
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let sawMarker = false;

  for (const name of readdirSync(sessionMessageDir).sort()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const raw = readFileSync(join(sessionMessageDir, name), "utf8");
    if (raw.includes(ctx.marker)) {
      sawMarker = true;
    }
    if (!sawMarker) {
      continue;
    }
    if (raw.includes(ctx.markerPrefix) && !raw.includes(ctx.marker)) {
      break;
    }
    try {
      const row = JSON.parse(raw) as {
        type?: string;
        tokens?: { input?: number; output?: number };
      };
      if (row.type === "step-finish" && row.tokens) {
        inputTokens += num(row.tokens.input);
        outputTokens += num(row.tokens.output);
      }
    } catch {}
  }

  return { found: true, inputTokens, outputTokens };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function empty(reason: string): SessionUsageResult {
  return { found: false, inputTokens: 0, outputTokens: 0, reason };
}
