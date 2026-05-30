import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { AcpConfig, AcpMcpServerConfig } from "~/types/acp-config.js";
import { DEFAULT_ACP_MCP } from "~/types/acp-config.js";

export type McpBundleContext = {
  actionId: bigint;
  stdbEnv: Record<string, string>;
  probeExecutable: string;
};

function envPair(key: string, value: string): { name: string; value: string } {
  return { name: key, value };
}

function toStdioServer(
  id: string,
  spec: AcpMcpServerConfig,
  extraEnv: Record<string, string>,
): McpServerStdio {
  const env = Object.entries({ ...extraEnv, ...spec.env }).map(([name, value]) =>
    envPair(name, value),
  );
  return {
    name: id,
    command: spec.command,
    args: spec.args ?? [],
    env,
  };
}

export function resolveProbeExecutable(): string {
  const override = process.env.PROBE_EXECUTABLE?.trim();
  if (!override) {
    return process.execPath;
  }
  if (!existsSync(override)) {
    throw new Error(`PROBE_EXECUTABLE does not exist: ${override}`);
  }
  const base = basename(override);
  if (base !== "probe" && base !== "node") {
    throw new Error(
      `PROBE_EXECUTABLE must be a probe or node binary (got ${base}); unset PROBE_EXECUTABLE to use the running executable`,
    );
  }
  return override;
}

export function buildMcpBundleContext(options: {
  actionId: bigint;
  token: string;
  host: string;
  module: string;
  wallet: string;
}): McpBundleContext {
  return {
    actionId: options.actionId,
    probeExecutable: resolveProbeExecutable(),
    stdbEnv: {
      PROBE_ACTION_ID: options.actionId.toString(),
      PROBE_STDB_TOKEN: options.token,
      PROBE_STDB_HOST: options.host,
      PROBE_STDB_MODULE: options.module,
      PROBE_WALLET: options.wallet,
    },
  };
}

export function buildSessionMcpServers(
  acpConfig: AcpConfig | undefined,
  bundle: McpBundleContext,
): McpServerStdio[] {
  if (acpConfig?.attachPerSessionMcp === false) {
    return [];
  }

  const merged = { ...DEFAULT_ACP_MCP, ...acpConfig?.mcp };
  const servers: McpServerStdio[] = [];

  for (const [id, spec] of Object.entries(merged)) {
    if (!spec || spec.enabled === false) {
      continue;
    }
    const env = { ...bundle.stdbEnv };
    if (id === "nexus") {
      servers.push(
        toStdioServer(
          "nexus",
          {
            ...spec,
            command: bundle.probeExecutable,
            args: spec.args ?? ["mcp", "serve"],
          },
          env,
        ),
      );
      continue;
    }
    servers.push(toStdioServer(id, spec, env));
  }

  return servers;
}
