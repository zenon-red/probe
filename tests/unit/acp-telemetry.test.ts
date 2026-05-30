import { describe, expect, it } from "bun:test";
import { ProbeAcpClient } from "../../src/acp/client.js";
import { TelemetryCollector } from "../../src/acp/telemetry.js";

describe("TelemetryCollector", () => {
  it("records prompt usage and run summary", () => {
    const collector = new TelemetryCollector();
    collector.recordPromptUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    collector.setStopReason("end_turn");

    const summary = collector.toSummaryEvent();
    expect(summary.token_source).toBe("acp_prompt");
    expect(summary.input_tokens).toBe(10);
    expect(summary.output_tokens).toBe(5);
    expect(summary.stop_reason).toBe("end_turn");
  });

  it("counts a single nexus tool call once", () => {
    const collector = new TelemetryCollector();
    collector.recordSessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "nexus_action_complete",
        status: "completed",
      },
    } as never);

    expect(collector.telemetry.toolCallsTotal).toBe(1);
    expect(collector.telemetry.nexusToolCalls).toBe(1);
    expect(collector.telemetry.toolCallsSucceeded).toBe(1);
    expect(collector.telemetry.mcpServerBreakdown.nexus?.calls).toBe(1);
  });

  it("does not double-count tool_call_update outcomes", () => {
    const collector = new TelemetryCollector();
    collector.recordSessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "nexus_vote",
        status: "in_progress",
      },
    } as never);
    collector.recordSessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      },
    } as never);

    expect(collector.telemetry.mcpServerBreakdown.nexus?.calls).toBe(1);
    expect(collector.telemetry.toolCallsSucceeded).toBe(1);
  });
});

describe("ProbeAcpClient telemetry integration", () => {
  it("does not double-count nexus tools", () => {
    const telemetry = new TelemetryCollector();
    const client = new ProbeAcpClient({ telemetry });
    void client.sessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "nexus_action_complete",
        status: "completed",
      },
    } as never);

    expect(telemetry.telemetry.nexusToolCalls).toBe(1);
    expect(telemetry.telemetry.mcpServerBreakdown.nexus?.calls).toBe(1);
  });
});
