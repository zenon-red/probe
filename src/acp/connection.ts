import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { agentStdioWebStreams, buildAcpAgentEnv, isChildRunning, spawnAcpAgent } from "./spawn.js";

export type AcpConnection = {
  connection: ClientSideConnection;
  child: ChildProcessByStdio<Writable, Readable, Readable>;
};

export const ACP_INIT_TIMEOUT_MS = 15_000;

export type OpenAcpConnectionOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  initTimeoutMs?: number;
};

export async function openAcpConnection(
  command: string,
  args: string[],
  toClient: (agent: Agent) => Client,
  options?: OpenAcpConnectionOptions,
): Promise<AcpConnection> {
  const env = options?.env ?? buildAcpAgentEnv();
  const child = spawnAcpAgent(command, args, { cwd: options?.cwd, env });
  const { input, output } = agentStdioWebStreams(child);
  const stream = ndJsonStream(input, output);
  const connection = new ClientSideConnection(toClient, stream);

  const initTimeoutMs = options?.initTimeoutMs ?? ACP_INIT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const initPromise = connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: {
      name: "probe-nexus",
      version: "1.0.0",
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ACP initialize timed out")), initTimeoutMs);
  });

  try {
    await Promise.race([initPromise, timeoutPromise]);
  } catch (error) {
    if (isChildRunning(child)) {
      child.kill("SIGTERM");
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  return { connection, child };
}
