import { createRequire } from "node:module";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { HarnessUsage } from "./types.js";

export type SqliteRow = Record<string, SQLOutputValue>;

export type ReadonlySqliteDb = {
  prepare: (sql: string) => {
    get: (...params: SQLInputValue[]) => SqliteRow | undefined;
    run: (...params: SQLInputValue[]) => void;
  };
  close: () => void;
};

export function withReadonlySqlite<T>(dbPath: string, fn: (db: ReadonlySqliteDb) => T): T | null {
  const db = openReadonlySqlite(dbPath);
  if (!db) return null;
  try {
    db.prepare("PRAGMA query_only = ON").run();
    db.prepare("PRAGMA busy_timeout = 1000").run();
    return fn(db);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function sqliteString(row: SqliteRow, key: string): string | null {
  const val = row[key];
  return typeof val === "string" ? val : null;
}

export function sqliteNumber(row: SqliteRow, key: string): number | null {
  const val = row[key];
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "bigint") return Number(val);
  return null;
}

function openReadonlySqlite(dbPath: string): ReadonlySqliteDb | null {
  const nodeDb = openNodeReadonlySqlite(dbPath);
  if (nodeDb) return nodeDb as ReadonlySqliteDb;
  return openBunReadonlySqlite(dbPath);
}

function openBunReadonlySqlite(dbPath: string): ReadonlySqliteDb | null {
  const bunSqlite = (
    globalThis as {
      Bun?: { sqlite?: (path: string, opts: { readonly: boolean }) => ReadonlySqliteDb };
    }
  ).Bun?.sqlite;
  if (!bunSqlite) return null;
  try {
    return bunSqlite(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

function openNodeReadonlySqlite(dbPath: string): DatabaseSync | null {
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync: DatabaseSyncCtor } =
      require("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSyncCtor(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

export function querySessionTotals(
  db: ReadonlySqliteDb,
  sessionId: string,
  inputColumn: string,
  outputColumn: string,
): HarnessUsage | null {
  const row = db
    .prepare(`SELECT ${inputColumn}, ${outputColumn} FROM sessions WHERE id = ? LIMIT 1`)
    .get(sessionId);
  if (!row) return null;
  const inputTokens = sqliteNumber(row, inputColumn);
  const outputTokens = sqliteNumber(row, outputColumn);
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens };
}
