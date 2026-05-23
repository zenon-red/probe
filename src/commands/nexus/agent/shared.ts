import type { Agent, CommandContext } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected, isProbeError } from "~/utils/errors.js";

export const MAX_VOICE_TRANSCRIPT_LENGTH = 500;
export const DEFAULT_VOICE_CONTEXT_TYPE = "status_update";

export const currentAgentForIdentity = (ctx: CommandContext): Agent | undefined => {
  return ctx.agents.find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
};

export const normalizeCapabilities = (value?: string): string[] => {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
};

export const renderAgentBio = (agent: Agent) => ({
  agentId: agent.id,
  name: agent.name,
  bio: agent.bio,
});

export async function runWithBoundary(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isProbeError(err)) throw err;
    failWithConnectionOrUnexpected(errorMessage(err));
  }
}
