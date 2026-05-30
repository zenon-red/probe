import type { HarnessType } from "~/types/config.js";
import { splitCommandLine } from "../spawn.js";

export const HARNESS_ACP_COMMANDS: Record<HarnessType, string> = {
  pi: "pi-acp",
  hermes: "hermes acp",
  openclaw: "openclaw acp",
  opencode: "opencode acp",
  claude: "claude-agent-acp",
  codex: "codex-acp",
  custom: "",
};

export function resolveHarnessAcpCommand(
  harness: HarnessType,
  customCommand?: string,
): { command: string; args: string[] } {
  if (harness === "custom") {
    if (!customCommand?.trim()) {
      throw new Error("custom harness requires harnessCommand in config");
    }
    return splitCommandLine(customCommand.trim());
  }

  const line = HARNESS_ACP_COMMANDS[harness];
  if (!line) {
    throw new Error(`No ACP command configured for harness: ${harness}`);
  }
  return splitCommandLine(line);
}
