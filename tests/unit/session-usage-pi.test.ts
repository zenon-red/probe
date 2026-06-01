import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractHarnessUsage } from "~/daemon/session-usage/extract.js";

describe("extractHarnessUsage pi", () => {
  it("sums assistant usage between markers", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sessions-"));
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const file = join(sessions, "2026-01-01_abc.jsonl");
    const lines = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "zenon.red{action:42}" },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: "ok",
          usage: { input: 10, output: 5 },
        },
      }),
    ];
    writeFileSync(file, lines.join("\n") + "\n");

    const runStartedAt = new Date(Date.now() - 60_000);
    const usage = await extractHarnessUsage("pi", 42n, runStartedAt, {
      markerTemplate: "zenon.red{action:%ACTION_ID%}",
      dataRoots: { pi: root },
    });

    expect(usage.found).toBe(true);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(5);
  });
});
