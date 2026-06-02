import type { InitializeResponse, McpServer, NewSessionResponse } from "@agentclientprotocol/sdk";
import type { HarnessType } from "~/types/config.js";
import type { AcpConfig } from "~/types/acp-config.js";
import type { AgentCapabilities } from "~/module_bindings/types.js";
import { DEFAULT_ACP_MCP } from "~/types/acp-config.js";
import { resolveHarnessAgentLaunch } from "./agents/launch.js";
import { ProbeAcpClient } from "./client.js";
import { openAcpConnection } from "./connection.js";
import { isChildRunning } from "./spawn.js";
import { TelemetryCollector } from "./telemetry.js";

export type NamedCapability = {
  id: string;
  name: string;
};

export type StructuredAgentCapabilities = AgentCapabilities;

type SnapshotCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

export type AcpCapabilitySnapshot = {
  initialize: InitializeResponse;
  session?: NewSessionResponse;
  configuredMcpServers: string[];
  availableCommands: SnapshotCommand[];
};

function id(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function named(name: string, fallback = name): NamedCapability {
  const normalized = id(name) || id(fallback);
  return { id: normalized, name };
}

function authMethodType(method: unknown): string {
  if (typeof method !== "object" || method === null || !("type" in method)) {
    return "agent";
  }
  const type = (method as { type?: unknown }).type;
  return typeof type === "string" ? id(type) : "agent";
}

export function enabledConfiguredMcpServerNames(acpConfig?: AcpConfig): string[] {
  if (acpConfig?.attachPerSessionMcp === false) {
    return [];
  }
  const merged = { ...DEFAULT_ACP_MCP, ...acpConfig?.mcp };
  return Object.entries(merged)
    .filter(([, spec]) => spec && spec.enabled !== false)
    .map(([serverId]) => serverId);
}

export function mcpServerNames(mcpServers: McpServer[]): string[] {
  return mcpServers.map((server) => server.name).filter(Boolean);
}

export function buildStructuredCapabilities(
  snapshot: AcpCapabilitySnapshot,
): StructuredAgentCapabilities {
  const caps = snapshot.initialize.agentCapabilities;
  const agentInfo = snapshot.initialize.agentInfo;
  return {
    agent: agentInfo
      ? {
          name: agentInfo.name,
          title: agentInfo.title ?? undefined,
          version: agentInfo.version ?? undefined,
        }
      : undefined,
    protocolVersion: String(snapshot.initialize.protocolVersion),
    prompt: {
      image: caps?.promptCapabilities?.image === true,
      audio: caps?.promptCapabilities?.audio === true,
      embeddedContext: caps?.promptCapabilities?.embeddedContext === true,
    },
    mcp: {
      http: caps?.mcpCapabilities?.http === true,
      sse: caps?.mcpCapabilities?.sse === true,
      acp: caps?.mcpCapabilities?.acp === true,
    },
    session: {
      load: caps?.loadSession === true,
      list: !!caps?.sessionCapabilities?.list,
      resume: !!caps?.sessionCapabilities?.resume,
      close: !!caps?.sessionCapabilities?.close,
      delete: !!caps?.sessionCapabilities?.delete,
      fork: !!caps?.sessionCapabilities?.fork,
      additionalDirectories: !!caps?.sessionCapabilities?.additionalDirectories,
    },
    auth: {
      logout: !!caps?.auth?.logout,
      methods: (snapshot.initialize.authMethods ?? []).map((method) => ({
        ...named(method.name ?? method.id, method.id),
        methodType: authMethodType(method),
      })),
    },
    configuredMcpServers: snapshot.configuredMcpServers.map((server) => named(server)),
    commands: snapshot.availableCommands.map((command) => ({
      name: command.name,
      description: command.description,
      inputHint: command.inputHint ?? undefined,
    })),
    modes: (snapshot.session?.modes?.availableModes ?? []).map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    })),
    configOptions: (snapshot.session?.configOptions ?? []).map((option) => ({
      id: option.id,
      name: option.name,
      category: option.category ?? undefined,
      optionType: option.type,
    })),
    models: (snapshot.session?.models?.availableModels ?? []).map((model) => ({
      id: model.modelId,
      name: model.name,
    })),
  };
}

export async function collectAcpCapabilities(options: {
  harness: HarnessType;
  harnessCommand?: string;
  cwd?: string;
  acpConfig?: AcpConfig;
}): Promise<StructuredAgentCapabilities> {
  const launch = await resolveHarnessAgentLaunch(options.harness, options.harnessCommand);
  const telemetry = new TelemetryCollector();
  const availableCommands: SnapshotCommand[] = [];
  const client = new ProbeAcpClient({
    telemetry,
    onEvent: (event) => {
      if (event.type !== "acp_available_commands" || !Array.isArray(event.commands)) {
        return;
      }
      for (const command of event.commands) {
        if (typeof command === "object" && typeof command.name === "string") {
          availableCommands.push({
            name: command.name,
            description: command.description ?? "",
            inputHint: command.inputHint ?? undefined,
          });
        }
      }
    },
  });

  const opened = await openAcpConnection(launch.command, launch.args, () => client, {
    cwd: options.cwd ?? process.cwd(),
  });

  let session: NewSessionResponse | undefined;
  try {
    session = await opened.connection.newSession({
      cwd: options.cwd ?? process.cwd(),
      mcpServers: [],
    });
    await opened.connection.closeSession({ sessionId: session.sessionId });
  } finally {
    if (isChildRunning(opened.child)) {
      opened.child.kill("SIGTERM");
    }
  }

  return buildStructuredCapabilities({
    initialize: opened.initializeResponse,
    session,
    configuredMcpServers: enabledConfiguredMcpServerNames(options.acpConfig),
    availableCommands,
  });
}
