import type { SessionNotification, Usage } from "@agentclientprotocol/sdk";
import type { ActionRunTelemetry, McpServerTelemetry, TokenSource } from "./types.js";

export function emptyTelemetry(): ActionRunTelemetry {
  return {
    inputTokens: 0,
    outputTokens: 0,
    tokenSource: "none",
    toolCallsTotal: 0,
    toolCallsSucceeded: 0,
    toolCallsFailed: 0,
    nexusToolCalls: 0,
    nexusToolCallsFailed: 0,
    promptTurns: 0,
    mcpServerBreakdown: {},
  };
}

export function isNexusToolName(value: string | undefined): boolean {
  return Boolean(value?.startsWith("nexus_"));
}

function applyUsage(telemetry: ActionRunTelemetry, usage: Usage, source: TokenSource): void {
  telemetry.inputTokens = usage.inputTokens ?? 0;
  telemetry.outputTokens = usage.outputTokens ?? 0;
  telemetry.tokenSource = source;
}

function ensureServer(
  breakdown: Record<string, McpServerTelemetry>,
  serverId: string,
): McpServerTelemetry {
  if (!breakdown[serverId]) {
    breakdown[serverId] = { calls: 0, succeeded: 0, failed: 0 };
  }
  return breakdown[serverId];
}

function isTerminalToolStatus(status: string | undefined): boolean {
  return (
    status === "completed" ||
    status === "succeeded" ||
    status === "success" ||
    status === "failed" ||
    status === "error"
  );
}

function isSuccessToolStatus(status: string | undefined): boolean {
  return status === "completed" || status === "succeeded" || status === "success";
}

function isFailedToolStatus(status: string | undefined): boolean {
  return status === "failed" || status === "error";
}

function recordToolOutcome(
  server: McpServerTelemetry,
  aggregates: ActionRunTelemetry,
  status: string | undefined,
  options: { incrementCall: boolean },
): void {
  if (options.incrementCall) {
    server.calls += 1;
  }
  if (isSuccessToolStatus(status)) {
    server.succeeded += 1;
    aggregates.toolCallsSucceeded += 1;
    return;
  }
  if (isFailedToolStatus(status)) {
    server.failed += 1;
    aggregates.toolCallsFailed += 1;
  }
}

export class TelemetryCollector {
  readonly telemetry: ActionRunTelemetry = emptyTelemetry();
  private readonly toolCallServers = new Map<string, string>();
  private readonly nexusToolTitles = new Map<string, string>();

  constructor(private readonly defaultServerId = "unknown") {}

  recordPromptTurn(): void {
    this.telemetry.promptTurns += 1;
  }

  recordPromptUsage(usage: Usage | null | undefined): void {
    if (!usage) {
      return;
    }
    applyUsage(this.telemetry, usage, "acp_prompt");
  }

  recordSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;
    if (!update) {
      return;
    }

    if (update.sessionUpdate === "usage_update") {
      const tokenUpdate = update as {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
      if (typeof tokenUpdate.inputTokens === "number") {
        applyUsage(
          this.telemetry,
          {
            inputTokens: tokenUpdate.inputTokens,
            outputTokens: tokenUpdate.outputTokens ?? 0,
            totalTokens:
              tokenUpdate.totalTokens ?? tokenUpdate.inputTokens + (tokenUpdate.outputTokens ?? 0),
          },
          "acp_usage_update",
        );
      }
      return;
    }

    if (update.sessionUpdate === "tool_call") {
      const serverId = this.inferServerId(update.title, update.rawInput);
      this.toolCallServers.set(update.toolCallId, serverId);
      if (update.title) {
        this.nexusToolTitles.set(update.toolCallId, update.title);
      }
      this.telemetry.toolCallsTotal += 1;
      const server = ensureServer(this.telemetry.mcpServerBreakdown, serverId);
      recordToolOutcome(server, this.telemetry, update.status ?? undefined, {
        incrementCall: true,
      });
      if (isNexusToolName(update.title)) {
        this.telemetry.nexusToolCalls += 1;
        if (isFailedToolStatus(update.status ?? undefined)) {
          this.telemetry.nexusToolCallsFailed += 1;
        }
      }
      return;
    }

    if (update.sessionUpdate === "tool_call_update") {
      const serverId = this.toolCallServers.get(update.toolCallId) ?? this.defaultServerId;
      const server = ensureServer(this.telemetry.mcpServerBreakdown, serverId);
      if (isTerminalToolStatus(update.status ?? undefined)) {
        recordToolOutcome(server, this.telemetry, update.status ?? undefined, {
          incrementCall: false,
        });
        const title = this.nexusToolTitles.get(update.toolCallId);
        if (isNexusToolName(title) && isFailedToolStatus(update.status ?? undefined)) {
          this.telemetry.nexusToolCallsFailed += 1;
        }
        this.toolCallServers.delete(update.toolCallId);
        this.nexusToolTitles.delete(update.toolCallId);
      }
    }
  }

  setStopReason(stopReason: string | undefined): void {
    this.telemetry.stopReason = stopReason;
  }

  setErrorReason(reason: string | undefined): void {
    this.telemetry.errorReason = reason;
  }

  toSummaryEvent(): Record<string, unknown> {
    return {
      type: "acp_run_summary",
      input_tokens: this.telemetry.inputTokens,
      output_tokens: this.telemetry.outputTokens,
      token_source: this.telemetry.tokenSource,
      tool_calls_total: this.telemetry.toolCallsTotal,
      tool_calls_succeeded: this.telemetry.toolCallsSucceeded,
      tool_calls_failed: this.telemetry.toolCallsFailed,
      nexus_tool_calls: this.telemetry.nexusToolCalls,
      nexus_tool_calls_failed: this.telemetry.nexusToolCallsFailed,
      prompt_turns: this.telemetry.promptTurns,
      stop_reason: this.telemetry.stopReason,
      error_reason: this.telemetry.errorReason,
      mcp_server_breakdown: this.telemetry.mcpServerBreakdown,
    };
  }

  private inferServerId(title: string | undefined, rawInput: unknown): string {
    if (typeof rawInput === "object" && rawInput && "server" in rawInput) {
      const server = (rawInput as { server?: string }).server;
      if (server) {
        return server;
      }
    }
    if (isNexusToolName(title)) {
      return "nexus";
    }
    return this.defaultServerId;
  }
}
