import { describe, expect, it } from "bun:test";
import { buildAcpAgentEnv, splitCommandLine } from "../../src/acp/spawn.js";

describe("splitCommandLine", () => {
  it("splits quoted commands", () => {
    expect(splitCommandLine("openclaw acp")).toEqual({
      command: "openclaw",
      args: ["acp"],
    });
  });
});

describe("buildAcpAgentEnv", () => {
  it("inherits the full host environment", () => {
    const env = buildAcpAgentEnv({
      PATH: "/bin",
      HOME: "/home/x",
      ANTHROPIC_API_KEY: "secret",
      GH_TOKEN: "gho_test",
      UNRELATED: "keep",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.ANTHROPIC_API_KEY).toBe("secret");
    expect(env.GH_TOKEN).toBe("gho_test");
    expect(env.UNRELATED).toBe("keep");
  });

  it("merges optional overrides on top of host env", () => {
    const env = buildAcpAgentEnv({ PATH: "/bin", GH_TOKEN: "old" }, { GH_TOKEN: "new" });
    expect(env.PATH).toBe("/bin");
    expect(env.GH_TOKEN).toBe("new");
  });
});
