/**
 * Hermes SQLite integration tests — run with Node (node:sqlite).
 * `npm run test:hermes`
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { extractHermesUsageExtraction } from "~/daemon/harness-usage.js";

const MARKER = "zenon.red{action:42}";
const MARKER_OTHER = "zenon.red{action:99}";

type TestSqlite = {
  exec: (sql: string) => void;
  close: () => void;
};

function openTestSqlite(dbPath: string): TestSqlite {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    close: () => db.close(),
  };
}

function writeHermesFixture(
  root: string,
  options: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    messages: Array<{ content: string; timestamp: number }>;
  },
): void {
  const db = openTestSqlite(join(root, "state.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL
    );
    CREATE TABLE messages (
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp REAL NOT NULL
    );
  `);
  db.exec(
    `INSERT INTO sessions (id, input_tokens, output_tokens) VALUES ('${options.sessionId}', ${options.inputTokens}, ${options.outputTokens})`,
  );
  for (const message of options.messages) {
    const escaped = message.content.replace(/'/g, "''");
    db.exec(
      `INSERT INTO messages (session_id, content, timestamp) VALUES ('${options.sessionId}', '${escaped}', ${message.timestamp})`,
    );
  }
  db.close();
}

describe("extractHermesUsageExtraction", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeHermesRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "hermes-test-"));
    tempRoots.push(root);
    return root;
  }

  test("returns session totals for one marker after runStartedAt", () => {
    const root = makeHermesRoot();
    const runStartedAt = new Date("2026-05-23T22:00:00.000Z");
    const markerTs = runStartedAt.getTime() / 1000 + 10;

    writeHermesFixture(root, {
      sessionId: "sess-1",
      inputTokens: 14069,
      outputTokens: 46,
      messages: [{ content: `hello ${MARKER}`, timestamp: markerTs }],
    });

    const result = extractHermesUsageExtraction(root, MARKER, runStartedAt);
    assert.deepEqual(result.usage, { inputTokens: 14069, outputTokens: 46 });
    assert.equal(result.debugReason, undefined);
  });

  test("ignores marker before runStartedAt", () => {
    const root = makeHermesRoot();
    const runStartedAt = new Date("2026-05-23T22:00:00.000Z");
    const markerTs = runStartedAt.getTime() / 1000 - 60;

    writeHermesFixture(root, {
      sessionId: "sess-1",
      inputTokens: 999,
      outputTokens: 99,
      messages: [{ content: MARKER, timestamp: markerTs }],
    });

    const result = extractHermesUsageExtraction(root, MARKER, runStartedAt);
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
    assert.equal(result.debugReason, "hermes_session_not_found");
  });

  test("returns zero for multiple dispatch markers in one session", () => {
    const root = makeHermesRoot();
    const runStartedAt = new Date("2026-05-23T22:00:00.000Z");
    const ts = runStartedAt.getTime() / 1000 + 5;

    writeHermesFixture(root, {
      sessionId: "sess-1",
      inputTokens: 500,
      outputTokens: 50,
      messages: [
        { content: MARKER, timestamp: ts },
        { content: MARKER_OTHER, timestamp: ts + 1 },
      ],
    });

    const result = extractHermesUsageExtraction(root, MARKER, runStartedAt);
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
    assert.equal(result.debugReason, "hermes_ambiguous_session");
  });

  test("uses JSON snapshot fallback when session is ambiguous", () => {
    const root = makeHermesRoot();
    const runStartedAt = new Date("2026-05-23T22:00:00.000Z");
    const ts = runStartedAt.getTime() / 1000 + 5;

    writeHermesFixture(root, {
      sessionId: "sess-1",
      inputTokens: 500,
      outputTokens: 50,
      messages: [
        { content: MARKER, timestamp: ts },
        { content: MARKER_OTHER, timestamp: ts + 1 },
      ],
    });

    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "snap.json"),
      `${MARKER}\n{"usage":{"input":120,"output":30}}\n`,
      "utf8",
    );

    const result = extractHermesUsageExtraction(root, MARKER, runStartedAt);
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 30 });
    assert.equal(result.debugReason, undefined);
  });

  test("reports missing state.db", () => {
    const root = makeHermesRoot();
    const result = extractHermesUsageExtraction(root, MARKER, new Date());
    assert.equal(result.debugReason, "hermes_state_db_missing");
  });
});
