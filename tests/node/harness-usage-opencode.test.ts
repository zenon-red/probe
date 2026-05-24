/** Run with Node: `npm run test:opencode` */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { extractOpencodeUsageExtraction } from "~/daemon/harness-usage.js";

const MARKER = "zenon.red{action:42}";

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

function writeOpencodeDbFixture(
  baseDir: string,
  options: {
    sessionId: string;
    tokensInput: number;
    tokensOutput: number;
    timeCreatedMs: number;
  },
): void {
  const db = openTestSqlite(join(baseDir, "opencode.db"));
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      tokens_input INTEGER NOT NULL,
      tokens_output INTEGER NOT NULL,
      time_created INTEGER NOT NULL
    );
  `);
  db.exec(
    `INSERT INTO session (id, tokens_input, tokens_output, time_created)
     VALUES ('${options.sessionId}', ${options.tokensInput}, ${options.tokensOutput}, ${options.timeCreatedMs})`,
  );
  db.close();
}

describe("extractOpencodeUsageExtraction", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "opencode-test-"));
    tempRoots.push(root);
    return root;
  }

  test("reads session totals from opencode.db when single dispatch marker", () => {
    const root = makeRoot();
    const storageDir = join(root, "storage");
    const sessionId = "ses_db";
    const runStartedAt = new Date(Date.now() - 60_000);
    const timeCreatedMs = Date.now() - 30_000;

    writeOpencodeDbFixture(root, {
      sessionId,
      tokensInput: 12_000,
      tokensOutput: 340,
      timeCreatedMs,
    });

    const markerPath = join(storageDir, "message", sessionId, "msg_user.json");
    mkdirSync(join(markerPath, ".."), { recursive: true });
    writeFileSync(markerPath, JSON.stringify({ type: "user", content: MARKER }), "utf8");

    const result = extractOpencodeUsageExtraction(MARKER, runStartedAt, {
      storageDir,
      baseDir: root,
    });
    assert.deepEqual(result.usage, { inputTokens: 12_000, outputTokens: 340 });
    assert.equal(result.debugReason, undefined);
  });
});
