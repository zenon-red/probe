// TODO: add unit tests for detectHarnesses and autoDetectHarness (mock execSync and existsSync)
import { existsSync } from "node:fs";
import { commandExists } from "./system.js";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessType } from "~/types/config.js";

export interface HarnessDetectionResult {
  harness: HarnessType;
  command: string;
  args: string[];
}

interface HarnessProbe {
  id: HarnessType;
  /** Check if the binary exists in PATH */
  pathCheck: string;
  /** Known directory to check */
  knownDir: string;
  /** CLI one-shot command prefix */
  command: string;
  /** Static args before the prompt placeholder */
  preArgs: string[];
}

// NOTE: Adding a new harness here requires updating buildHarnessSpawnArgs() in nexus-daemon.ts
const HARNESS_PROBES: HarnessProbe[] = [
  {
    id: "pi",
    pathCheck: "pi",
    knownDir: join(homedir(), "pi-mono"),
    command: "pi",
    preArgs: ["-p"],
  },
  {
    id: "hermes",
    pathCheck: "hermes",
    knownDir: join(homedir(), ".hermes"),
    command: "hermes",
    preArgs: ["-z"],
  },
  {
    id: "openclaw",
    pathCheck: "openclaw",
    knownDir: join(homedir(), ".openclaw"),
    command: "openclaw",
    preArgs: ["agent", "-m", "--json"],
  },
  {
    id: "opencode",
    pathCheck: "opencode",
    knownDir: join(homedir(), ".opencode"),
    command: "opencode",
    preArgs: ["run"],
  },
];

function hasKnownDir(dir: string): boolean {
  return existsSync(dir);
}

/**
 * Detect installed harnesses by checking PATH and known directories.
 * Returns the list of detected harnesses.
 */
export function detectHarnesses(): HarnessDetectionResult[] {
  const results: HarnessDetectionResult[] = [];

  for (const probe of HARNESS_PROBES) {
    if (commandExists(probe.pathCheck) || hasKnownDir(probe.knownDir)) {
      results.push({
        harness: probe.id,
        command: probe.command,
        args: probe.preArgs,
      });
    }
  }

  return results;
}

/**
 * Auto-detect a single harness. Returns the detection result or throws
 * if zero or multiple harnesses are detected without explicit config.
 */
export function autoDetectHarness(): HarnessDetectionResult {
  const detected = detectHarnesses();

  if (detected.length === 0) {
    throw new Error(
      "No harness detected. Install one of: pi, hermes, openclaw, opencode — or set harness explicitly in config.",
    );
  }

  if (detected.length === 1) {
    return detected[0];
  }

  const names = detected.map((d) => d.harness).join(", ");
  throw new Error(
    `Multiple harnesses detected (${names}). Specify which one to use in config or via --harness flag.`,
  );
}
