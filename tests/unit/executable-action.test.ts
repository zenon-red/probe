import { describe, expect, it } from "bun:test";
import { parseAgentActionRow, toExecutableAction } from "../../src/daemon/executable-action.js";

describe("executable-action", () => {
  const issuedRow = {
    id: 99n,
    agentId: "agent-1",
    kind: { tag: "ExecuteTask" },
    status: { tag: "Issued" },
    reasonCode: "dispatch",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    skills: ["zr-run"],
    instruction: "run",
    triggerType: "dispatch_run",
    route: { tag: "ExecuteTask" },
  };

  it("toExecutableAction preserves bigint id", () => {
    const action = toExecutableAction(issuedRow);
    expect(action?.id).toBe(99n);
  });

  it("toExecutableAction rejects non-issued rows", () => {
    expect(toExecutableAction({ ...issuedRow, status: { tag: "Completed" } })).toBeNull();
  });

  it("parseAgentActionRow rejects garbage", () => {
    expect(parseAgentActionRow(null)).toBeNull();
    expect(parseAgentActionRow({ agentId: "x" })).toBeNull();
  });
});
