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
  it("copies base keys and API prefixes", () => {
    const env = buildAcpAgentEnv({
      PATH: "/bin",
      HOME: "/home/x",
      ANTHROPIC_API_KEY: "secret",
      UNRELATED: "drop",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.ANTHROPIC_API_KEY).toBe("secret");
    expect(env.UNRELATED).toBeUndefined();
  });
});
