import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sumScopedJsonlUsage } from "./correlate.js";
import type { SessionUsageContext, SessionUsageResult } from "./types.js";
import { resolveSessionRoot } from "./roots.js";

export function extractHermesSessionUsage(ctx: SessionUsageContext): SessionUsageResult {
  const root = resolveSessionRoot("hermes", ctx.dataRoots);
  if (!root || !existsSync(root)) {
    return empty("hermes_root_missing");
  }

  const dbPath = join(root, "state.db");
  if (existsSync(dbPath)) {
    const fromDb = extractHermesFromDb(dbPath, ctx.marker);
    if (fromDb.found) {
      return fromDb;
    }
  }

  return extractHermesFromSnapshots(root, ctx);
}

function extractHermesFromDb(dbPath: string, marker: string): SessionUsageResult {
  try {
    const esc = marker.replace(/'/g, "''");
    const sessionId = execFileSync(
      "sqlite3",
      [
        dbPath,
        `SELECT session_id FROM messages WHERE content LIKE '%${esc}%' ORDER BY timestamp DESC LIMIT 1;`,
      ],
      { encoding: "utf8" },
    ).trim();
    if (!sessionId) {
      return empty("hermes_db_marker_missing");
    }
    const sid = sessionId.replace(/'/g, "''");
    const row = execFileSync(
      "sqlite3",
      [dbPath, `SELECT input_tokens, output_tokens FROM sessions WHERE id = '${sid}' LIMIT 1;`],
      { encoding: "utf8" },
    ).trim();
    const [inputRaw, outputRaw] = row.split("|");
    return {
      found: true,
      inputTokens: num(inputRaw),
      outputTokens: num(outputRaw),
    };
  } catch {
    return empty("hermes_db_unavailable");
  }
}

function extractHermesFromSnapshots(root: string, ctx: SessionUsageContext): SessionUsageResult {
  const snapshots = join(root, "sessions");
  if (!existsSync(snapshots)) {
    return empty("hermes_session_not_found");
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(jsonl?|json)$/i.test(path)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (!text.includes(ctx.marker)) {
        continue;
      }
      const usage = sumScopedJsonlUsage(path, ctx.marker, ctx.markerPrefix);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      found = true;
    }
  };

  walk(snapshots);
  if (!found) {
    return empty("hermes_session_not_found");
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
