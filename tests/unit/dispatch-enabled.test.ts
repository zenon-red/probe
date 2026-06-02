import { describe, expect, it } from "bun:test";
import {
  dispatchLabel,
  dispatchLabelFromConfig,
  readDispatchEnabled,
} from "../../src/utils/dispatch-enabled.js";
import { resolveDispatchFromEvents } from "../../src/daemon/status-reader.js";
import type { DaemonEvent } from "../../src/daemon/events.js";

describe("dispatch-enabled", () => {
  it("reads config rows", () => {
    expect(readDispatchEnabled([{ key: "dispatch_enabled", value: "false" }])).toBe(false);
    expect(dispatchLabelFromConfig([{ key: "dispatch_enabled", value: "true" }])).toBe("on");
    expect(dispatchLabel(false)).toBe("off");
  });

  it("resolveDispatchFromEvents prefers latest module_dispatch", () => {
    const events: DaemonEvent[] = [
      { type: "module_dispatch", source: "nexus", at: "t1", dispatch: "off" },
      { type: "module_dispatch", source: "nexus", at: "t2", dispatch: "on" },
    ];
    expect(resolveDispatchFromEvents(events, "unknown")).toBe("on");
  });
});
