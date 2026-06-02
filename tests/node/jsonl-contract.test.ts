import { describe, expect, it } from "bun:test";
import { createEventBus } from "../../src/daemon/events.js";

describe("daemon JSONL contract", () => {
  it("emits one JSON line per event with stable envelope fields", () => {
    const lines: string[] = [];
    const bus = createEventBus({
      logLevel: "critical",
      write: (line) => lines.push(line),
      now: () => "2026-06-01T12:00:00.000Z",
    });
    bus.emit({ type: "connected", wallet: "alice" });
    bus.emit({ type: "module_dispatch", dispatch: "on" });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({
      type: "connected",
      source: "nexus",
      at: "2026-06-01T12:00:00.000Z",
      wallet: "alice",
    });
    const second = JSON.parse(lines[1]!);
    expect(second.type).toBe("module_dispatch");
    expect(second.dispatch).toBe("on");
  });
});
