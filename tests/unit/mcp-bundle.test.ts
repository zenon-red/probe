import { describe, expect, it } from "bun:test";
import { buildSessionMcpServers } from "../../src/mcp/bundle.js";

describe("buildSessionMcpServers", () => {
  it("builds nexus stdio server with action env", () => {
    const servers = buildSessionMcpServers(undefined, {
      actionId: 42n,
      probeExecutable: "/usr/bin/node",
      stdbEnv: {
        PROBE_ACTION_ID: "42",
        PROBE_STDB_TOKEN: "tok",
        PROBE_STDB_HOST: "wss://db.example",
        PROBE_STDB_MODULE: "nexus",
        PROBE_WALLET: "agent-wallet",
      },
    });

    const nexus = servers.find((s) => s.name === "nexus");
    expect(nexus?.command).toBe("/usr/bin/node");
    expect(nexus?.args).toEqual(["mcp", "serve"]);
    expect(nexus?.env.some((e) => e.name === "PROBE_ACTION_ID" && e.value === "42")).toBe(true);
  });

  it("returns empty when attachPerSessionMcp is false", () => {
    const servers = buildSessionMcpServers(
      { attachPerSessionMcp: false },
      {
        actionId: 1n,
        probeExecutable: "probe",
        stdbEnv: {},
      },
    );
    expect(servers).toEqual([]);
  });
});
