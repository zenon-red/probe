import { resolveMarkerPrefix } from "./marker-scope.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileContainsMarker, forEachLineSync, walkFiles } from "./fs.js";
import { sumOpenclawUsageFromScopedJsonl, sumOpenclawUsageFromScopedText } from "./openclaw.js";
import {
  querySessionTotals,
  sqliteNumber,
  sqliteString,
  withReadonlySqlite,
  type ReadonlySqliteDb,
} from "./sqlite.js";
import { EMPTY_USAGE, type HarnessUsage, type HarnessUsageExtraction } from "./types.js";

export const HERMES_ROOT = () => join(homedir(), ".hermes");

function runStartedAtToHermesTimestamp(runStartedAt: Date): number {
  return runStartedAt.getTime() / 1000;
}

export function extractHermesUsageExtraction(
  hermesRoot: string,
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

  const dbPath = join(hermesRoot, "state.db");
  if (!existsSync(dbPath)) {
    return { usage: EMPTY_USAGE, debugReason: "hermes_state_db_missing" };
  }

  const minTimestamp = runStartedAtToHermesTimestamp(runStartedAt);
  const result = withReadonlySqlite(dbPath, (db) => {
    const sessionId = findHermesSessionIdInDb(db, marker, minTimestamp);
    if (!sessionId) {
      return { usage: EMPTY_USAGE, debugReason: "hermes_session_not_found" };
    }

    const markerCount = countHermesSessionMarkersInDb(db, sessionId, markerPrefix, minTimestamp);
    if (markerCount > 1) {
      const snapshotUsage = sumHermesJsonSnapshots(hermesRoot, marker, markerPrefix);
      if (snapshotUsage.inputTokens > 0 || snapshotUsage.outputTokens > 0) {
        return { usage: snapshotUsage };
      }
      return { usage: EMPTY_USAGE, debugReason: "hermes_ambiguous_session" };
    }

    const totals = querySessionTotals(db, sessionId, "input_tokens", "output_tokens");
    if (!totals) {
      return { usage: EMPTY_USAGE, debugReason: "hermes_session_totals_missing" };
    }
    return { usage: totals };
  });

  if (result === null) {
    return { usage: EMPTY_USAGE, debugReason: "sqlite_unavailable" };
  }
  return result;
}

function sumHermesJsonSnapshots(
  hermesRoot: string,
  marker: string,
  markerPrefix: string,
): HarnessUsage {
  const sessionsDir = join(hermesRoot, "sessions");
  if (!existsSync(sessionsDir)) {
    return EMPTY_USAGE;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  for (const path of walkFiles(sessionsDir)) {
    if (!/\.(jsonl?|json)$/i.test(path)) continue;
    if (!fileContainsMarker(path, marker)) continue;
    const fromJsonl = sumOpenclawUsageFromScopedJsonl(path, marker, markerPrefix);
    if (fromJsonl.inputTokens > 0 || fromJsonl.outputTokens > 0) {
      inputTokens += fromJsonl.inputTokens;
      outputTokens += fromJsonl.outputTokens;
      continue;
    }
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
    const textUsage = sumOpenclawUsageFromScopedText(scoped);
    inputTokens += textUsage.inputTokens;
    outputTokens += textUsage.outputTokens;
  }
  return { inputTokens, outputTokens };
}

function findHermesSessionIdInDb(
  db: ReadonlySqliteDb,
  marker: string,
  minTimestamp: number,
): string | null {
  const row = db
    .prepare(
      `SELECT session_id FROM messages
       WHERE content LIKE ? AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 1`,
    )
    .get(`%${marker}%`, minTimestamp);
  const sessionId = row ? sqliteString(row, "session_id") : null;
  return sessionId && sessionId.length > 0 ? sessionId : null;
}

function countHermesSessionMarkersInDb(
  db: ReadonlySqliteDb,
  sessionId: string,
  markerPrefix: string,
  minTimestamp: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE session_id = ? AND content LIKE ? AND timestamp >= ?`,
    )
    .get(sessionId, `%${markerPrefix}%`, minTimestamp);
  return row ? (sqliteNumber(row, "count") ?? 0) : 0;
}
