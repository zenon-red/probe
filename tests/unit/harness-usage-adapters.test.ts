import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  extractOpencodeUsageExtraction,
  extractOpenclawUsageExtraction,
  extractPiUsageExtraction,
  sumPiUsageFromLines,
} from "~/daemon/harness-usage.js";

const MARKER = "zenon.red{action:42}";
const MARKER_OTHER = "zenon.red{action:99}";

describe("harness usage adapters", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
  }

  function touchInPast(path: string, msAgo: number): void {
    const at = new Date(Date.now() - msAgo);
    utimesSync(path, at, at);
  }

  test("pi sums assistant usage in scoped jsonl after runStartedAt", () => {
    const root = makeRoot("pi-");
    const runStartedAt = new Date(Date.now() - 60_000);
    const sessionPath = join(root, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ message: { role: "user", usage: { input: 999, output: 999 } } }),
        JSON.stringify({ text: MARKER }),
        JSON.stringify({ message: { role: "assistant", usage: { input: 100, output: 20 } } }),
        JSON.stringify({ message: { role: "assistant", usage: { input: 50, output: 10 } } }),
      ].join("\n"),
      "utf8",
    );
    touchInPast(sessionPath, 30_000);

    const result = extractPiUsageExtraction(root, MARKER, runStartedAt);
    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 30 });
    expect(result.debugReason).toBeUndefined();
  });

  test("pi ignores non-assistant usage rows", () => {
    const lines = [
      JSON.stringify({ message: { role: "user", usage: { input: 999, output: 999 } } }),
      JSON.stringify({ message: { role: "assistant", usage: { input: 10, output: 2 } } }),
    ];
    expect(sumPiUsageFromLines(lines)).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  test("pi returns not found when marker is only in old session", () => {
    const root = makeRoot("pi-old-");
    const runStartedAt = new Date();
    const sessionPath = join(root, "old.jsonl");
    writeFileSync(sessionPath, JSON.stringify({ text: MARKER }), "utf8");
    touchInPast(sessionPath, 3_600_000);

    const result = extractPiUsageExtraction(root, MARKER, runStartedAt);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.debugReason).toBe("pi_session_not_found");
  });

  test("opencode sums step-finish parts after marker message", () => {
    const root = makeRoot("opencode-");
    const storageDir = join(root, "storage");
    const sessionId = "ses_test";
    const runStartedAt = new Date(Date.now() - 60_000);

    const markerPath = join(storageDir, "message", sessionId, "msg_user.json");
    const finishPath = join(storageDir, "part", "msg_user", "prt_finish.json");
    mkdirSync(join(markerPath, ".."), { recursive: true });
    mkdirSync(join(finishPath, ".."), { recursive: true });

    writeFileSync(
      markerPath,
      JSON.stringify({ type: "user", content: `do work\n${MARKER}` }),
      "utf8",
    );
    writeFileSync(
      finishPath,
      JSON.stringify({
        type: "step-finish",
        sessionID: sessionId,
        tokens: { input: 800, output: 120 },
      }),
      "utf8",
    );
    touchInPast(markerPath, 40_000);
    touchInPast(finishPath, 20_000);

    const result = extractOpencodeUsageExtraction(MARKER, runStartedAt, {
      storageDir,
      baseDir: root,
    });
    expect(result.usage).toEqual({ inputTokens: 800, outputTokens: 120 });
  });

  test("opencode stops at next action marker in session", () => {
    const root = makeRoot("opencode-stop-");
    const storageDir = join(root, "storage");
    const sessionId = "ses_test";
    const runStartedAt = new Date(Date.now() - 60_000);

    const markerPath = join(storageDir, "message", sessionId, "01-user.json");
    const otherPath = join(storageDir, "message", sessionId, "03-other.json");
    const finish1 = join(storageDir, "part", "msg_01", "02-finish.json");
    const finish2 = join(storageDir, "part", "msg_02", "04-finish.json");
    mkdirSync(join(markerPath, ".."), { recursive: true });
    mkdirSync(join(finish1, ".."), { recursive: true });
    mkdirSync(join(finish2, ".."), { recursive: true });

    writeFileSync(markerPath, JSON.stringify({ type: "user", content: MARKER }), "utf8");
    writeFileSync(
      finish1,
      JSON.stringify({
        type: "step-finish",
        sessionID: sessionId,
        tokens: { input: 100, output: 10 },
      }),
      "utf8",
    );
    writeFileSync(otherPath, JSON.stringify({ type: "user", content: MARKER_OTHER }), "utf8");
    writeFileSync(
      finish2,
      JSON.stringify({
        type: "step-finish",
        sessionID: sessionId,
        tokens: { input: 999, output: 99 },
      }),
      "utf8",
    );
    touchInPast(markerPath, 50_000);
    touchInPast(finish1, 40_000);
    touchInPast(otherPath, 30_000);
    touchInPast(finish2, 20_000);

    const result = extractOpencodeUsageExtraction(MARKER, runStartedAt, {
      storageDir,
      baseDir: root,
    });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
  });

  test("openclaw parses scoped jsonl usage", () => {
    const root = makeRoot("openclaw-");
    const runStartedAt = new Date(Date.now() - 60_000);
    const sessionPath = join(root, "transcript.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ text: MARKER }),
        JSON.stringify({ usage: { input: 300, output: 40 } }),
        JSON.stringify({ text: MARKER_OTHER, usage: { input: 999, output: 99 } }),
      ].join("\n"),
      "utf8",
    );
    touchInPast(sessionPath, 20_000);

    const result = extractOpenclawUsageExtraction(root, MARKER, runStartedAt);
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 40 });
  });
});
