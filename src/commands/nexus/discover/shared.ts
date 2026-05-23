import type { DiscoveryDecision } from "~/module_bindings/types.js";
import { errorMessage, failWithConnectionOrUnexpected, isProbeError } from "~/utils/errors.js";

export const toDiscoveryDecision = (input: string): DiscoveryDecision | null => {
  const value = input.toLowerCase();
  if (value === "approve") return { tag: "ApproveAsTask" };
  if (value === "reject") return { tag: "Reject" };
  if (value === "escalate_to_idea") return { tag: "EscalateToIdea" };
  return null;
};

export const discoveryStatusTag = (status: unknown): string => {
  if (status && typeof status === "object" && "tag" in status) {
    return String((status as { tag: string }).tag);
  }
  return String(status);
};

export const discoveryStatusDisplay = (status: unknown): string => {
  const tag = discoveryStatusTag(status);
  const map: Record<string, string> = {
    PendingReview: "pending_review",
    Approved: "approved",
    Rejected: "rejected",
    EscalatedToIdea: "escalated_to_idea",
  };
  return map[tag] ?? tag;
};

export async function runWithBoundary(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isProbeError(err)) throw err;
    failWithConnectionOrUnexpected(errorMessage(err));
  }
}
