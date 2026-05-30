import type { StopReason } from "@agentclientprotocol/sdk";
import type { AgentRunOutcome } from "./types.js";

export function mapStopReasonToOutcome(
  stopReason: StopReason | undefined,
  spawnFailed: boolean,
  timedOut: boolean,
): AgentRunOutcome {
  if (spawnFailed) {
    return "SpawnFailed";
  }
  if (timedOut) {
    return "Timeout";
  }
  if (stopReason === "end_turn") {
    return "Clean";
  }
  if (stopReason === "cancelled") {
    return "Timeout";
  }
  if (
    stopReason === "refusal" ||
    stopReason === "max_tokens" ||
    stopReason === "max_turn_requests"
  ) {
    return "Signal";
  }
  return "Signal";
}
