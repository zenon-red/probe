import type { ActionSidecar } from "./sidecar.js";
import type { DaemonEvent } from "./events.js";

export const NEXUS_STATUS_SCHEMA = "nexus.status.v1" as const;

export type NexusStatusV1 = {
  schema: typeof NEXUS_STATUS_SCHEMA;
  wallet?: string;
  host?: string;
  module?: string;
  harness?: string;
  dispatch?: string;
  uptimeSecs?: number;
  actions: Array<{
    actionId: string;
    state: string;
    harness?: string;
    elapsedSecs?: number;
  }>;
  spend?: { totalCost?: number };
  recentErrors: Array<{ at: string; type: string; message?: string }>;
  connectedAt?: string;
};

export type NexusStatusHistoryV1 = {
  schema: typeof NEXUS_STATUS_SCHEMA;
  events: DaemonEvent[];
};

export type NexusStatusActionV1 = {
  schema: typeof NEXUS_STATUS_SCHEMA;
  action: ActionSidecar;
};

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatSummary(status: NexusStatusV1): string {
  const uptime = status.uptimeSecs != null ? `up ${Math.floor(status.uptimeSecs / 60)}m` : "up ?";
  const dispatch = status.dispatch ?? "unknown";
  const done = status.actions.filter((a) => a.state === "completed").length;
  const total = status.actions.length;
  const spend = status.spend?.totalCost != null ? `$${status.spend.totalCost.toFixed(3)}` : "$?";
  const errors = status.recentErrors.length;
  return `nexus: ${uptime} · dispatch:${dispatch} · actions: ${done}/${total} done · spend: ${spend} · errors(5m): ${errors}`;
}
