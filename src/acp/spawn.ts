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

const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "TERM",
] as const;

const ENV_KEY_PREFIXES = [
  "ANTHROPIC_",
  "OPENAI_",
  "CLAUDE_",
  "CODEX_",
  "GOOGLE_",
  "AZURE_",
  "AWS_",
  "HERMES_",
  "OPENCODE_",
  "PROBE_",
] as const;

/** Minimal env for ACP child agents: base paths plus known API-key prefixes. */
export function buildAcpAgentEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of BASE_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return env;
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
