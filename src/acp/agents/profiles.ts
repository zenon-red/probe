import type { HarnessType } from "~/types/config.js";
import { HARNESS_ACP_COMMANDS } from "./registry.js";

export type AgentProfile = {
  harness: HarnessType;
  acpCommand: string;
  usageRequired: boolean;
  supportsPerSessionMcp: boolean;
  openclawGatewayMcp?: boolean;
};

export const AGENT_PROFILES: Record<HarnessType, AgentProfile> = {
  opencode: {
    harness: "opencode",
    acpCommand: HARNESS_ACP_COMMANDS.opencode,
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
  hermes: {
    harness: "hermes",
    acpCommand: HARNESS_ACP_COMMANDS.hermes,
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
  pi: {
    harness: "pi",
    acpCommand: HARNESS_ACP_COMMANDS.pi,
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
  claude: {
    harness: "claude",
    acpCommand: HARNESS_ACP_COMMANDS.claude,
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
  codex: {
    harness: "codex",
    acpCommand: HARNESS_ACP_COMMANDS.codex,
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
  openclaw: {
    harness: "openclaw",
    acpCommand: HARNESS_ACP_COMMANDS.openclaw,
    usageRequired: true,
    supportsPerSessionMcp: false,
    openclawGatewayMcp: true,
  },
  custom: {
    harness: "custom",
    acpCommand: "",
    usageRequired: true,
    supportsPerSessionMcp: true,
  },
};

export function profileForHarness(harness: HarnessType): AgentProfile {
  return AGENT_PROFILES[harness];
}
