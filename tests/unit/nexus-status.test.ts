import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildStatusFromEvents,
  defaultAuditLogPath,
  estimateTokenCount,
  filterEvents,
  readJsonlEvents,
  parseSinceDuration,
  resolveDispatchFromEvents,
} from "../../src/daemon/status-reader.js";
import { formatSummary } from "../../src/daemon/status-schema.js";
import type { DaemonEvent } from "../../src/daemon/events.js";

describe("nexus status", () => {
  it("defaults to the nexus audit namespace", () => {
    const prevAuditRoot = process.env.PROBE_NEXUS_AUDIT_ROOT;
    delete process.env.PROBE_NEXUS_AUDIT_ROOT;
    try {
      expect(defaultAuditLogPath("w")).toContain(
        join(".probe", "audit", "nexus", "w", "nexus.jsonl"),
      );
    } finally {
      if (prevAuditRoot != null) process.env.PROBE_NEXUS_AUDIT_ROOT = prevAuditRoot;
    }
  });

  it("buildStatusFromEvents includes schema fields", () => {
    const events: DaemonEvent[] = [
      {
        type: "connected",
        source: "nexus",
        at: new Date().toISOString(),
        wallet: "w",
        host: "h",
        module: "m",
      },
      {
        type: "action_started",
        source: "nexus",
        at: new Date().toISOString(),
        action_id: "1",
      },
      {
        type: "action_completed",
        source: "nexus",
        at: new Date().toISOString(),
        action_id: "1",
      },
    ];
    const status = buildStatusFromEvents(events, { wallet: "w" });
    expect(status.schema).toBe("nexus.status.v1");
    expect(status.actions).toHaveLength(1);
    expect(status.actions[0]?.state).toBe("completed");
  });

  it("buildStatusFromEvents reads wallet and harness from ready events", () => {
    const status = buildStatusFromEvents(
      [
        {
          type: "connected",
          source: "nexus",
          at: new Date().toISOString(),
          host: "h",
          module: "m",
        },
        {
          type: "ready",
          source: "nexus",
          at: new Date().toISOString(),
          wallet: "agent-wallet",
          harness: "pi",
        },
      ],
      {},
    );

    expect(status.wallet).toBe("agent-wallet");
    expect(status.harness).toBe("pi");
  });

  it("summary stays within token budget", () => {
    const status = buildStatusFromEvents([], { wallet: "w", harness: "opencode" });
    const summary = formatSummary(status);
    expect(estimateTokenCount(summary)).toBeLessThanOrEqual(200);
  });

  it("filterEvents respects limit", () => {
    const events: DaemonEvent[] = Array.from({ length: 50 }, (_, i) => ({
      type: "heartbeat_ok",
      source: "nexus" as const,
      at: new Date().toISOString(),
      n: i,
    }));
    const filtered = filterEvents(events, { limit: 10 });
    expect(filtered).toHaveLength(10);
  });

  it("readJsonlEvents returns only the bounded tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-status-"));
    const path = join(dir, "nexus.jsonl");
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        type: "heartbeat_ok",
        source: "nexus",
        at: new Date().toISOString(),
        n: i,
      }),
    );
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    const events = await readJsonlEvents(path, { limit: 2 });

    expect(events).toHaveLength(2);
    expect(events[0]?.n).toBe(3);
    expect(events[1]?.n).toBe(4);
  });

  it("readJsonlEvents treats missing audit logs as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-status-"));
    await expect(readJsonlEvents(join(dir, "missing.jsonl"))).resolves.toEqual([]);
  });

  it("parseSinceDuration parses minutes", () => {
    expect(parseSinceDuration("5m")).toBe(5 * 60_000);
  });

  it("resolveDispatchFromEvents uses module_dispatch events", () => {
    const events = [
      { type: "module_dispatch", source: "nexus" as const, at: "t", dispatch: "off" },
    ];
    expect(resolveDispatchFromEvents(events)).toBe("off");
  });
});
