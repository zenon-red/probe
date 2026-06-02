import { describe, expect, it } from "bun:test";
import { readJsonlEvents } from "../../src/daemon/status-reader.js";
import { renderReplaySnapshot } from "../../src/daemon/tui/render.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("nexus TUI replay inputs", () => {
  it("readJsonlEvents parses recorded daemon lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jsonl-"));
    const path = join(dir, "nexus.jsonl");
    await writeFile(
      path,
      '{"type":"connected","source":"nexus","at":"2026-06-01T00:00:00.000Z","wallet":"w"}\n{"type":"module_dispatch","source":"nexus","at":"2026-06-01T00:00:01.000Z","dispatch":"on"}\n',
      "utf8",
    );
    const events = await readJsonlEvents(path);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("module_dispatch");
  });

  it("renders a deterministic non-TTY replay snapshot", () => {
    const text = renderReplaySnapshot([
      {
        type: "connected",
        source: "nexus",
        at: "2026-06-01T00:00:00.000Z",
        wallet: "w",
      },
      {
        type: "module_dispatch",
        source: "nexus",
        at: "2026-06-01T00:00:01.000Z",
        dispatch: "on",
      },
    ]);

    expect(text).toContain("wallet: w");
    expect(text).toContain("dispatch: on");
  });
});
