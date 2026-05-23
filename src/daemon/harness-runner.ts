import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";

export type AgentRunOutcome = "Clean" | "Signal" | "Timeout" | "SpawnFailed";

export type HarnessProcessResult = {
  outcome: AgentRunOutcome;
  durationSecs: number;
};

export type SpawnRunner = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export function buildHarnessSpawnArgs(harness: HarnessDetectionResult, prompt: string): string[] {
  if (harness.harness === "pi") return ["pi", "-p", prompt];
  if (harness.harness === "hermes") return ["hermes", "-z", prompt];
  if (harness.harness === "openclaw") return ["openclaw", "agent", "-m", prompt, "--json"];
  if (harness.harness === "opencode") return ["opencode", "run", prompt];
  return [harness.command, ...harness.args, prompt];
}

export async function runHarness(options: {
  harness: HarnessDetectionResult;
  prompt: string;
  timeoutSecs: number;
  spawnFn?: SpawnRunner;
  onChild?: (child: ChildProcess) => void;
}): Promise<HarnessProcessResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const spawnArgs = buildHarnessSpawnArgs(options.harness, options.prompt);
  const command = spawnArgs[0];
  const commandArgs = spawnArgs.slice(1);
  const startTime = Date.now();

  let outcome: AgentRunOutcome = "SpawnFailed";
  let timedOut = false;

  try {
    const result = await new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolve, reject) => {
        const child = spawnFn(command, commandArgs, { shell: false, stdio: "pipe" });
        options.onChild?.(child);

        let settled = false;
        const settle = (result: { exitCode: number | null; signal: string | null }) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const timeout =
          options.timeoutSecs > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill("SIGKILL");
                settle({ exitCode: null, signal: "SIGKILL" });
              }, options.timeoutSecs * 1000)
            : null;

        child.on("close", (code, signal) => {
          if (timeout) clearTimeout(timeout);
          settle({ exitCode: code, signal });
        });

        child.on("error", (err) => {
          if (timeout) clearTimeout(timeout);
          settled = true;
          reject(err);
        });
      },
    );

    if (timedOut) {
      outcome = "Timeout";
    } else if (result.exitCode === 0) {
      outcome = "Clean";
    } else {
      outcome = "Signal";
    }
  } catch {
    outcome = "SpawnFailed";
  }

  return {
    outcome,
    durationSecs: Math.round((Date.now() - startTime) / 1000),
  };
}
