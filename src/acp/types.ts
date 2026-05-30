export type TokenSource = "acp_prompt" | "acp_usage_update" | "none";

export type McpServerTelemetry = {
  calls: number;
  succeeded: number;
  failed: number;
};

export type ActionRunTelemetry = {
  inputTokens: number;
  outputTokens: number;
  tokenSource: TokenSource;
  toolCallsTotal: number;
  toolCallsSucceeded: number;
  toolCallsFailed: number;
  nexusToolCalls: number;
  nexusToolCallsFailed: number;
  promptTurns: number;
  stopReason?: string;
  errorReason?: string;
  mcpServerBreakdown: Record<string, McpServerTelemetry>;
};

export type AgentRunOutcome = "Clean" | "Signal" | "Timeout" | "SpawnFailed";

export type AcpRunResult = {
  outcome: AgentRunOutcome;
  durationSecs: number;
  telemetry: ActionRunTelemetry;
  completionReported: boolean;
  nexusMcpAttached: boolean;
};
