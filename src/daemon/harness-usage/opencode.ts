import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  fileContainsMarker,
  fileMtimeMs,
  findNewestFileWithMarker,
  listFiles,
  readJsonFile,
} from "./fs.js";
import { getNumber } from "./json.js";
import { MARKER_PREFIX, recordContainsOtherActionMarker } from "./marker-scope.js";
import { sqliteNumber, withReadonlySqlite } from "./sqlite.js";
import { EMPTY_USAGE, type HarnessUsage, type HarnessUsageExtraction } from "./types.js";

export type OpencodeLocation = { baseDir: string; storageDir: string };

export type OpencodeExtractionOptions = {
  storageDir?: string;
  baseDir?: string;
};

type OpencodeMarkerMatch = { sessionId: string; markerPath: string; mtimeMs: number };

export function extractOpencodeUsageExtraction(
  marker: string,
  runStartedAt: Date,
  options?: OpencodeExtractionOptions,
): HarnessUsageExtraction {
  const locations = options?.storageDir
    ? [{ baseDir: options.baseDir ?? options.storageDir, storageDir: options.storageDir }]
    : resolveOpencodeLocations();
  if (!locations.length) {
    return { usage: EMPTY_USAGE, debugReason: "opencode_root_missing" };
  }

  const minMtimeMs = runStartedAt.getTime();
  let match: (OpencodeMarkerMatch & OpencodeLocation) | null = null;
  for (const location of locations) {
    const candidate = findOpencodeMarkerMatch(location.storageDir, marker, minMtimeMs);
    if (!candidate) continue;
    if (!match || candidate.mtimeMs > match.mtimeMs) {
      match = { ...candidate, ...location };
    }
  }
  if (!match) {
    return { usage: EMPTY_USAGE, debugReason: "opencode_message_not_found" };
  }

  const { sessionId, markerPath, storageDir, baseDir } = match;
  const markerCount = countOpencodeDispatchMarkers(storageDir, sessionId, minMtimeMs);

  if (markerCount <= 1) {
    const dbUsage = queryOpencodeSessionTokens(baseDir, sessionId, minMtimeMs);
    if (dbUsage) {
      return { usage: dbUsage };
    }
  }

  const usage = sumOpencodePartsForSession(
    storageDir,
    sessionId,
    marker,
    minMtimeMs,
    markerPath,
    match.mtimeMs,
  );
  if (markerCount > 1 && usage.inputTokens === 0 && usage.outputTokens === 0) {
    return { usage, debugReason: "opencode_ambiguous_session" };
  }
  return { usage };
}

export function sumOpencodeUsageFromObject(obj: unknown): HarnessUsage {
  if (!obj || typeof obj !== "object") return EMPTY_USAGE;
  const record = obj as Record<string, unknown>;
  if (record.type !== "step-finish") return EMPTY_USAGE;
  const tokens = record.tokens;
  if (!tokens || typeof tokens !== "object") return EMPTY_USAGE;
  const input = getNumber(tokens as Record<string, unknown>, "input");
  const output = getNumber(tokens as Record<string, unknown>, "output");
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
  };
}

function resolveOpencodeLocations(): OpencodeLocation[] {
  const bases = new Set<string>();
  const dataDir = process.env.OPENCODE_DATA_DIR;
  if (dataDir) bases.add(dataDir);
  bases.add(join(homedir(), ".local", "share", "opencode"));

  const locations: OpencodeLocation[] = [];
  for (const baseDir of bases) {
    const storageDir = join(baseDir, "storage");
    if (existsSync(storageDir)) {
      locations.push({ baseDir, storageDir });
    }
  }

  const cwd = process.cwd();
  for (const rel of [".opencode/storage", "global/storage"] as const) {
    const storageDir = join(cwd, rel);
    if (!existsSync(storageDir)) continue;
    const baseDir = rel === ".opencode/storage" ? join(cwd, ".opencode") : cwd;
    locations.push({ baseDir, storageDir });
  }

  return locations;
}

function findOpencodeMarkerMatch(
  storageDir: string,
  marker: string,
  minMtimeMs: number,
): OpencodeMarkerMatch | null {
  const messageRoot = join(storageDir, "message");
  const partRoot = join(storageDir, "part");
  const searchRoots = [messageRoot, partRoot].filter(existsSync);
  let best: OpencodeMarkerMatch | null = null;
  for (const root of searchRoots) {
    const hit = findNewestFileWithMarker(root, marker, minMtimeMs, (p) => /\.json$/i.test(p));
    if (!hit) continue;
    const sessionId = extractOpencodeSessionId(hit.path);
    if (!sessionId) continue;
    const preferMessage = root === messageRoot;
    if (!best || hit.mtimeMs > best.mtimeMs || (hit.mtimeMs === best.mtimeMs && preferMessage)) {
      best = { sessionId, markerPath: hit.path, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

function extractOpencodeSessionId(path: string): string | null {
  return path.match(/(ses_[^/]+)/)?.[1] ?? null;
}

function countOpencodeDispatchMarkers(
  storageDir: string,
  sessionId: string,
  minMtimeMs: number,
): number {
  let count = 0;
  const messageSessionDir = join(storageDir, "message", sessionId);
  if (existsSync(messageSessionDir)) {
    for (const path of listFiles(messageSessionDir)) {
      const mtimeMs = fileMtimeMs(path);
      if (mtimeMs === null || mtimeMs < minMtimeMs) continue;
      if (fileContainsMarker(path, MARKER_PREFIX)) count += 1;
    }
  }

  const partRoot = join(storageDir, "part");
  if (!existsSync(partRoot)) return count;

  let entries;
  try {
    entries = readdirSync(partRoot, { withFileTypes: true });
  } catch {
    return count;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const msgDir = join(partRoot, entry.name);
    for (const partPath of listFiles(msgDir)) {
      const mtimeMs = fileMtimeMs(partPath);
      if (mtimeMs === null || mtimeMs < minMtimeMs) continue;
      try {
        const record = readJsonFile(partPath) as Record<string, unknown>;
        if (record.sessionID !== sessionId) continue;
        if (fileContainsMarker(partPath, MARKER_PREFIX)) count += 1;
      } catch {
        continue;
      }
    }
  }
  return count;
}

function queryOpencodeSessionTokens(
  baseDir: string,
  sessionId: string,
  minCreatedMs: number,
): HarnessUsage | null {
  const dbPath = join(baseDir, "opencode.db");
  if (!existsSync(dbPath)) return null;

  return withReadonlySqlite(dbPath, (db) => {
    const row = db
      .prepare(
        `SELECT tokens_input, tokens_output FROM session
         WHERE id = ? AND time_created >= ?
         LIMIT 1`,
      )
      .get(sessionId, minCreatedMs);
    if (!row) return null;
    const inputTokens = sqliteNumber(row, "tokens_input");
    const outputTokens = sqliteNumber(row, "tokens_output");
    if (inputTokens === null || outputTokens === null) return null;
    return { inputTokens, outputTokens };
  });
}

function sumOpencodePartsForSession(
  storageDir: string,
  sessionId: string,
  marker: string,
  minMtimeMs: number,
  markerPath: string,
  markerMtimeMs: number,
): HarnessUsage {
  const partRoot = join(storageDir, "part");
  if (!existsSync(partRoot)) return EMPTY_USAGE;

  const files: Array<{ path: string; mtimeMs: number }> = [];
  let entries;
  try {
    entries = readdirSync(partRoot, { withFileTypes: true });
  } catch {
    return EMPTY_USAGE;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const msgDir = join(partRoot, entry.name);
    for (const partPath of listFiles(msgDir)) {
      let record: Record<string, unknown>;
      try {
        record = readJsonFile(partPath) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record.sessionID !== sessionId) continue;
      const mtimeMs = fileMtimeMs(partPath);
      if (mtimeMs === null || mtimeMs < minMtimeMs) continue;
      files.push({ path: partPath, mtimeMs });
    }
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
  const nextMarkerMtime = nextOpencodeDispatchMarkerMtime(
    storageDir,
    sessionId,
    markerMtimeMs,
    marker,
  );

  let startIndex = files.findIndex((f) => f.path === markerPath);
  if (startIndex === -1) {
    startIndex = files.findIndex((f) => fileContainsMarker(f.path, marker));
  }

  const slice =
    startIndex === -1 ? files.filter((f) => f.mtimeMs >= markerMtimeMs) : files.slice(startIndex);

  let inputTokens = 0;
  let outputTokens = 0;
  for (let i = 0; i < slice.length; i++) {
    const file = slice[i]!;
    if (nextMarkerMtime !== null && file.mtimeMs >= nextMarkerMtime) break;
    let parsed: unknown;
    try {
      parsed = readJsonFile(file.path);
    } catch {
      continue;
    }
    if (i > 0 && recordContainsOtherActionMarker(parsed, marker)) break;
    const usage = sumOpencodeUsageFromObject(parsed);
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}

function nextOpencodeDispatchMarkerMtime(
  storageDir: string,
  sessionId: string,
  afterMtimeMs: number,
  marker: string,
): number | null {
  let next: number | null = null;
  const messageSessionDir = join(storageDir, "message", sessionId);
  if (!existsSync(messageSessionDir)) return next;

  for (const path of listFiles(messageSessionDir)) {
    const mtimeMs = fileMtimeMs(path);
    if (mtimeMs === null || mtimeMs <= afterMtimeMs) continue;
    let parsed: unknown;
    try {
      parsed = readJsonFile(path);
    } catch {
      continue;
    }
    if (!recordContainsOtherActionMarker(parsed, marker)) continue;
    if (next === null || mtimeMs < next) next = mtimeMs;
  }
  return next;
}
