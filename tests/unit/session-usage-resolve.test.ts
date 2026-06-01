import { describe, expect, it } from "bun:test";
import type { ActionRunTelemetry } from "~/acp/types.js";
import { resolveRunTokens } from "~/daemon/session-usage/resolve.js";

function acpTelemetry(overrides: Partial<ActionRunTelemetry> = {}): ActionRunTelemetry {
  return {
    inputTokens: 0,
    outputTokens: 0,
    tokenSource: "none",
    toolCallsTotal: 0,
    toolCallsSucceeded: 0,
    toolCallsFailed: 0,
    nexusToolCalls: 0,
    nexusToolCallsFailed: 0,
    promptTurns: 1,
    mcpServerBreakdown: {},
    ...overrides,
  };
}

describe("resolveRunTokens", () => {
  it("prefers ACP when present and no session shim applies", async () => {
    const resolved = await resolveRunTokens(
      "claude",
      1n,
      new Date(),
      acpTelemetry({
        inputTokens: 100,
        outputTokens: 50,
        tokenSource: "acp_prompt",
      }),
    );
    expect(resolved.tokenSource).toBe("acp_prompt");
    expect(resolved.inputTokens).toBe(100);
    expect(resolved.outputTokens).toBe(50);
    expect(resolved.tokenMismatch).toBe(false);
  });

  it("returns none when claude has no ACP usage and no session shim", async () => {
    const resolved = await resolveRunTokens("claude", 99n, new Date(), acpTelemetry());
    expect(resolved.tokenSource).toBe("none");
    expect(resolved.inputTokens).toBe(0);
  });

  it("prefers session_file when ACP reports acp_prompt with zero totals", async () => {
    const tmp = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const root = await tmp.mkdtemp(path.join(os.tmpdir(), "probe-resolve-"));
    const sessions = path.join(root, "agent", "sessions");
    await tmp.mkdir(sessions, { recursive: true });
    const marker = "zenon.red.lab{action:7}";
    const sessionPath = path.join(sessions, "run.jsonl");
    const startedAt = new Date();
    await tmp.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: marker }] },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", usage: { input: 100, output: 40 } },
        }),
      ].join("\n") + "\n",
    );
    const past = new Date(startedAt.getTime() - 1000);
    await tmp.utimes(sessionPath, past, past);

    const resolved = await resolveRunTokens(
      "pi",
      7n,
      startedAt,
      acpTelemetry({ tokenSource: "acp_prompt", inputTokens: 0, outputTokens: 0 }),
      {
        markerTemplate: "zenon.red.lab{action:%ACTION_ID%}",
        dataRoots: { pi: root },
      },
    );

    expect(resolved.tokenSource).toBe("session_file");
    expect(resolved.inputTokens).toBe(100);
    expect(resolved.outputTokens).toBe(40);

    await tmp.rm(root, { recursive: true, force: true });
  });
});
