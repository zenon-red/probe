import { describe, expect, it } from "bun:test";
import { remediationFromNpx } from "../../src/acp/agents/adapter-registry.js";

describe("adapter doctor helpers", () => {
  it("builds install remediation from npx metadata", () => {
    expect(remediationFromNpx({ package: "@agentclientprotocol/claude-agent-acp@0.39.0" })).toBe(
      "npm i -g @agentclientprotocol/claude-agent-acp@0.39.0",
    );
  });

  it("package.json does not bundle claude/codex agent sdks", async () => {
    const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    expect(deps["@anthropic-ai/claude-agent-sdk"]).toBeUndefined();
    expect(deps["@openai/codex"]).toBeUndefined();
  });
});
