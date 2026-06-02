import { describe, expect, it } from "bun:test";
import { createEventBus } from "../../src/daemon/events.js";

describe("daemon event bus", () => {
  it("delivers the same envelope to JSONL writer and subscribers", () => {
    const lines: string[] = [];
    const seen: unknown[] = [];
    const bus = createEventBus({
      logLevel: "critical",
      write: (line) => lines.push(line),
      now: () => "2026-06-01T00:00:00.000Z",
    });
    bus.subscribe((event) => seen.push(event));
    bus.emit({ type: "connected", wallet: "alice" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      type: "connected",
      source: "nexus",
      at: "2026-06-01T00:00:00.000Z",
      wallet: "alice",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(JSON.parse(lines[0]!));
  });
});
