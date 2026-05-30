import { existsSync } from "node:fs";
import { commandExists } from "./system.js";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessType } from "~/types/config.js";

export interface HarnessDetectionDeps {
  commandExists: (command: string) => boolean;
  existsSync: (path: string) => boolean;
}

function defaultHarnessDetectionDeps(): HarnessDetectionDeps {
  return { commandExists, existsSync };
}

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
  {
    id: "claude",
    pathCheck: "claude-agent-acp",
    knownDir: join(homedir(), ".claude"),
    command: "claude-agent-acp",
    preArgs: [],
  },
  {
    id: "codex",
    pathCheck: "codex-acp",
    knownDir: join(homedir(), ".codex"),
    command: "codex-acp",
    preArgs: [],
  },
];

function hasKnownDir(dir: string, deps: HarnessDetectionDeps): boolean {
  return deps.existsSync(dir);
}

/**
 * Detect installed harnesses by checking PATH and known directories.
 * Returns the list of detected harnesses.
 */
export function detectHarnesses(
  deps: HarnessDetectionDeps = defaultHarnessDetectionDeps(),
): HarnessDetectionResult[] {
  const results: HarnessDetectionResult[] = [];

  for (const probe of HARNESS_PROBES) {
    if (deps.commandExists(probe.pathCheck) || hasKnownDir(probe.knownDir, deps)) {
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
export function autoDetectHarness(
  deps: HarnessDetectionDeps = defaultHarnessDetectionDeps(),
): HarnessDetectionResult {
  const resolution = resolveOnboardHarness("auto", deps);
  if (resolution.kind === "resolved") {
    return resolution.harness;
  }
  if (resolution.kind === "none") {
    throw new Error(
      "No harness detected. Install one of: pi, hermes, openclaw, opencode — or set harness explicitly in config.",
    );
  }
  throw new Error(formatAmbiguousHarnessMessage(resolution.detected));
}

export type OnboardHarnessResolution =
  | { kind: "resolved"; harness: HarnessDetectionResult }
  | { kind: "ambiguous"; detected: HarnessDetectionResult[] }
  | { kind: "none" };

function harnessFromEnv(detected: HarnessDetectionResult[]): HarnessDetectionResult | undefined {
  const raw = process.env.PROBE_HARNESS || process.env.HARNESS;
  if (!raw || raw === "auto" || raw === "custom") {
    return undefined;
  }
  return detected.find((d) => d.harness === raw);
}

export function formatHarnessOperatorQuestion(detected: HarnessDetectionResult[]): string {
  const names = detected.map((d) => d.harness);
  const n = names.length;
  const options = names.map((h) => `- ${h}`).join("\n");
  const countWord = n === 2 ? "two" : String(n);
  return [
    `There are ${countWord} possible harnesses we could use to interact with Nexus. Which one would you like to use?`,
    "",
    options,
  ].join("\n");
}

export function formatAmbiguousHarnessMessage(detected: HarnessDetectionResult[]): string {
  const names = detected.map((d) => d.harness).join(", ");
  return [
    `Multiple harness CLIs are installed: ${names}.`,
    "",
    "Ask your operator (see join.md — harness question), then rerun onboard with:",
    "",
    formatHarnessOperatorQuestion(detected),
    "",
    '  probe onboard --name "<display name>" --harness <choice>',
    "",
    "If the operator set PROBE_HARNESS (or HARNESS) in the environment, rerun with --harness auto.",
  ].join("\n");
}

export function resolveOnboardHarness(
  harnessArg: string | undefined,
  deps: HarnessDetectionDeps = defaultHarnessDetectionDeps(),
): OnboardHarnessResolution {
  const detected = detectHarnesses(deps);
  const arg = harnessArg?.trim() || "auto";

  if (arg !== "auto") {
    const match = detected.find((d) => d.harness === arg);
    if (!match) {
      if (detected.length === 0) {
        return { kind: "none" };
      }
      throw new Error(
        `Harness "${arg}" not detected. Installed: ${detected.map((d) => d.harness).join(", ")}`,
      );
    }
    return { kind: "resolved", harness: match };
  }

  const fromEnv = harnessFromEnv(detected);
  if (fromEnv) {
    return { kind: "resolved", harness: fromEnv };
  }

  if (detected.length === 0) {
    return { kind: "none" };
  }
  if (detected.length === 1) {
    return { kind: "resolved", harness: detected[0] };
  }
  return { kind: "ambiguous", detected };
}
