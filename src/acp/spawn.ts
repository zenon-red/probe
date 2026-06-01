import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptions,
} from "node:child_process";
import { Readable, Writable } from "node:stream";

export type CommandParts = {
  command: string;
  args: string[];
};

export function splitCommandLine(value: string): CommandParts {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const ch of value) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (quote) {
    throw new Error(`Invalid agent command: unterminated quote in ${value}`);
  }
  if (current.length > 0) {
    parts.push(current);
  }
  if (parts.length === 0) {
    throw new Error(`Invalid agent command: empty command (${value})`);
  }

  return { command: parts[0], args: parts.slice(1) };
}

export function buildAcpAgentEnv(
  source: NodeJS.ProcessEnv = process.env,
  overrides?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return overrides ? { ...source, ...overrides } : { ...source };
}

export function spawnAcpAgent(
  command: string,
  args: string[],
  options?: Pick<SpawnOptions, "cwd" | "env">,
): ChildProcessByStdio<Writable, Readable, Readable> {
  const child = spawn(command, args, {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("ACP agent must be spawned with piped stdin/stdout/stderr");
  }

  return child as ChildProcessByStdio<Writable, Readable, Readable>;
}

export function agentStdioWebStreams(child: ChildProcessByStdio<Writable, Readable, Readable>): {
  input: WritableStream<Uint8Array>;
  output: ReadableStream<Uint8Array>;
} {
  return {
    input: Writable.toWeb(child.stdin),
    output: Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  };
}

export function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode == null && child.signalCode == null;
}
