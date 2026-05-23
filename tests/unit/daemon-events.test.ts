import { describe, expect, it } from "bun:test";
import {
  CRITICAL_EVENTS,
  createEventEmitter,
  jsonReplacer,
  resolveLogLevel,
  sanitizeValue,
  shouldEmit,
} from "../../src/daemon/events.js";

describe("daemon events", () => {
  describe("shouldEmit", () => {
    it("emits all events at debug level", () => {
      expect(shouldEmit("heartbeat_tick", "debug")).toBe(true);
      expect(shouldEmit("noise", "debug")).toBe(true);
    });

    it("emits critical events at critical level", () => {
      for (const eventType of CRITICAL_EVENTS) {
        expect(shouldEmit(eventType, "critical")).toBe(true);
      }
    });

    it("filters non-critical events at critical level", () => {
      expect(shouldEmit("heartbeat_tick", "critical")).toBe(false);
      expect(shouldEmit("table_insert", "critical")).toBe(false);
    });

    it("emits heartbeat_* events at info level", () => {
      expect(shouldEmit("heartbeat_sent", "info")).toBe(true);
      expect(shouldEmit("heartbeat_failed", "info")).toBe(true);
      expect(shouldEmit("table_insert", "info")).toBe(false);
    });
  });

  describe("sanitizeValue and jsonReplacer", () => {
    it("serializes Error objects", () => {
      expect(sanitizeValue(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
    });

    it("converts bigint to string", () => {
      expect(sanitizeValue(42n)).toBe("42");
      expect(jsonReplacer("x", 99n)).toBe("99");
    });

    it("passes through primitives", () => {
      expect(sanitizeValue("ok")).toBe("ok");
      expect(sanitizeValue(1)).toBe(1);
      expect(sanitizeValue(true)).toBe(true);
      expect(sanitizeValue(null)).toBe(null);
    });

    it("deep-clones plain objects via JSON", () => {
      const input = { nested: { value: 1n }, list: [2, 3] };
      expect(sanitizeValue(input)).toEqual({ nested: { value: "1" }, list: [2, 3] });
    });

    it("falls back to String for non-serializable values", () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;
      expect(typeof sanitizeValue(circular)).toBe("string");
    });
  });

  describe("resolveLogLevel", () => {
    it("accepts valid levels", () => {
      expect(resolveLogLevel("critical")).toBe("critical");
      expect(resolveLogLevel("info")).toBe("info");
      expect(resolveLogLevel("debug")).toBe("debug");
    });

    it("defaults unknown values to critical", () => {
      expect(resolveLogLevel("verbose")).toBe("critical");
      expect(resolveLogLevel(undefined)).toBe("critical");
    });
  });

  describe("createEventEmitter", () => {
    it("writes JSONL with source and at fields", () => {
      const lines: string[] = [];
      const emit = createEventEmitter({
        logLevel: "critical",
        write: (line) => lines.push(line),
        now: () => "2026-05-23T00:00:00.000Z",
      });

      emit({ type: "connected", identity: "abc" });

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed).toMatchObject({
        type: "connected",
        source: "nexus",
        at: "2026-05-23T00:00:00.000Z",
        identity: "abc",
      });
    });

    it("filters events by log level", () => {
      const lines: string[] = [];
      const emit = createEventEmitter({
        logLevel: "critical",
        write: (line) => lines.push(line),
      });

      emit({ type: "heartbeat_tick" });
      emit({ type: "ready" });

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).type).toBe("ready");
    });
  });
});
