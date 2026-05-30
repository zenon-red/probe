import type {
  Client,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import { resolveUnattendedPermission } from "./permissions.js";
import { isNexusToolName, type TelemetryCollector } from "./telemetry.js";

export type ProbeAcpClientOptions = {
  telemetry: TelemetryCollector;
  boundActionId?: bigint;
  onEvent?: (event: Record<string, unknown>) => void;
};

function usageUpdateHasTokens(update: Record<string, unknown>): boolean {
  return typeof update.inputTokens === "number";
}

function emitNexusToolEvent(
  options: ProbeAcpClientOptions,
  tool: string,
  ok: boolean,
  status: string | undefined,
): void {
  options.onEvent?.({
    type: "acp_nexus_tool_call",
    tool,
    ok,
    status,
    action_id: options.boundActionId?.toString(),
  });
}

export class ProbeAcpClient implements Client {
  constructor(private readonly options: ProbeAcpClientOptions) {}

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.options.telemetry.recordSessionUpdate(params);
    const update = params.update;
    if (!update) {
      return;
    }

    if (update.sessionUpdate === "tool_call") {
      const title = update.title ?? "";
      if (isNexusToolName(title)) {
        const ok = update.status === "completed";
        emitNexusToolEvent(this.options, title, ok, update.status);
      } else {
        this.options.onEvent?.({
          type: "acp_tool_call",
          tool_call_id: update.toolCallId,
          title: update.title,
          status: update.status,
        });
      }
      return;
    }

    if (update.sessionUpdate === "tool_call_update") {
      const title = update.title ?? "";
      if (isNexusToolName(title) && (update.status === "completed" || update.status === "failed")) {
        emitNexusToolEvent(this.options, title, update.status === "completed", update.status);
      }
      return;
    }

    if (update.sessionUpdate === "usage_update") {
      const tokenUpdate = update as Record<string, unknown>;
      if (!usageUpdateHasTokens(tokenUpdate)) {
        this.options.onEvent?.({ type: "acp_usage_unavailable" });
      } else {
        this.options.onEvent?.({
          type: "acp_usage",
          token_source: this.options.telemetry.telemetry.tokenSource,
          input_tokens: this.options.telemetry.telemetry.inputTokens,
          output_tokens: this.options.telemetry.telemetry.outputTokens,
        });
      }
    }
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return resolveUnattendedPermission(params);
  }

  async readTextFile(_params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error("readTextFile is not supported by probe-nexus ACP client");
  }

  async writeTextFile(_params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error("writeTextFile is not supported by probe-nexus ACP client");
  }
}
