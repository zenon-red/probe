import type { HarnessType } from "~/types/config.js";
import { splitCommandLine, type CommandParts } from "../spawn.js";
import { HARNESS_ACP_COMMANDS } from "./registry.js";
import {
  isAdapterHarness,
  resolveAdapterLaunch,
  type ResolvedAdapterLaunch,
} from "./adapter-registry.js";

export type HarnessLaunchResolution = CommandParts & {
  registryId?: string;
  version?: string;
  source?: ResolvedAdapterLaunch["source"];
  remediation?: string;
};

export async function resolveHarnessAgentLaunch(
  harness: HarnessType,
  customCommand?: string,
): Promise<HarnessLaunchResolution> {
  if (harness === "custom") {
    if (!customCommand?.trim()) {
      throw new Error("custom harness requires harnessCommand in config");
    }
    return splitCommandLine(customCommand.trim());
  }

  if (isAdapterHarness(harness)) {
    return resolveAdapterLaunch(harness);
  }

  const line = HARNESS_ACP_COMMANDS[harness];
  if (!line) {
    throw new Error(`No ACP command configured for harness: ${harness}`);
  }
  return splitCommandLine(line);
}
