import { afterEach, describe, expect, it } from "bun:test";
import { assertBoundActionId, requiredBoundActionId } from "../../src/mcp/nexus-context.js";

describe("nexus MCP context", () => {
  const prev = process.env.PROBE_ACTION_ID;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.PROBE_ACTION_ID;
    } else {
      process.env.PROBE_ACTION_ID = prev;
    }
  });

  it("requiredBoundActionId reads PROBE_ACTION_ID", () => {
    process.env.PROBE_ACTION_ID = "99";
    expect(requiredBoundActionId()).toBe(99n);
  });

  it("assertBoundActionId rejects mismatched action id", () => {
    process.env.PROBE_ACTION_ID = "42";
    expect(() => assertBoundActionId(43n)).toThrow(/does not match/);
  });

  it("assertBoundActionId accepts matching action id", () => {
    process.env.PROBE_ACTION_ID = "42";
    expect(() => assertBoundActionId(42n)).not.toThrow();
  });
});
