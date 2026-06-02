import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { DaemonEvent } from "./events.js";
import { readActionSidecar, sidecarPathForAction } from "./sidecar-read.js";
import { dispatchLabelFromConfig } from "~/utils/dispatch-enabled.js";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { nexusAuditLogPath } from "./audit-paths.js";
import {
  formatSummary,
  NEXUS_STATUS_SCHEMA,
  type NexusStatusHistoryV1,
  type NexusStatusV1,
  estimateTokenCount,
} from "./status-schema.js";
import { projectDaemonEvents, projectionToStatus, type ProjectionContext } from "./projection.js";

const STATUS_EVENT_LIMIT = 5_000;
const HISTORY_SCAN_LIMIT = 10_000;

export function defaultAuditLogPath(wallet: string): string {
  return nexusAuditLogPath(wallet);
}

export function resolveAuditLogPath(wallet: string, logFile?: string): string {
  return logFile ? resolve(logFile) : defaultAuditLogPath(wallet);
}

export async function readJsonlEvents(
  path: string,
  options: { limit?: number } = {},
): Promise<DaemonEvent[]> {
  const limit = options.limit ?? STATUS_EVENT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const events: DaemonEvent[] = [];
  try {
    const stream = createReadStream(path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as DaemonEvent);
        if (events.length > limit) events.shift();
      } catch {
        // skip malformed lines
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return events;
}

export function resolveDispatchFromEvents(
  events: DaemonEvent[],
  fallback: string = "unknown",
): string {
  return projectDaemonEvents(events, { dispatch: fallback }).dispatch;
}

export function parseSinceDuration(value: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (multipliers[unit] ?? 0);
}

export function filterEvents(
  events: DaemonEvent[],
  options: { type?: string; sinceMs?: number; limit: number },
): DaemonEvent[] {
  const now = Date.now();
  let filtered = events;
  if (options.type) {
    filtered = filtered.filter((e) => e.type === options.type);
  }
  if (options.sinceMs != null) {
    const cutoff = now - options.sinceMs;
    filtered = filtered.filter((e) => Date.parse(String(e.at)) >= cutoff);
  }
  return filtered.slice(-options.limit);
}

export function buildStatusFromEvents(
  events: DaemonEvent[],
  context: ProjectionContext,
): NexusStatusV1 {
  return projectionToStatus(projectDaemonEvents(events, context));
}

export async function fetchDispatchFromStdb(args: {
  wallet?: string;
  host?: string;
  module?: string;
}): Promise<string | undefined> {
  if (!args.wallet) return undefined;
  let label: string | undefined;
  await withAuth(
    commandContextOptions(args, { subscribe: ["SELECT * FROM config"] }),
    async (ctx) => {
      label = dispatchLabelFromConfig(ctx.stdbConfig);
    },
  );
  return label;
}

export async function loadNexusStatus(options: {
  wallet: string;
  logFile?: string;
  host?: string;
  module?: string;
  harness?: string;
  liveDispatch?: boolean;
}): Promise<NexusStatusV1> {
  const path = resolveAuditLogPath(options.wallet, options.logFile);
  const events = await readJsonlEvents(path, { limit: STATUS_EVENT_LIMIT });
  let dispatch: string | undefined;
  if (options.liveDispatch) {
    try {
      dispatch = await fetchDispatchFromStdb({
        wallet: options.wallet,
        host: options.host,
        module: options.module,
      });
    } catch {
      dispatch = undefined;
    }
  }
  return buildStatusFromEvents(events, { ...options, dispatch });
}

export async function loadNexusStatusHistory(options: {
  wallet: string;
  logFile?: string;
  filterType?: string;
  since?: string;
  limit: number;
}): Promise<NexusStatusHistoryV1> {
  const path = resolveAuditLogPath(options.wallet, options.logFile);
  const scanLimit = Math.min(HISTORY_SCAN_LIMIT, Math.max(options.limit * 20, options.limit));
  const events = await readJsonlEvents(path, { limit: scanLimit });
  const sinceMs = options.since ? parseSinceDuration(options.since) : undefined;
  const filtered = filterEvents(events, {
    type: options.filterType,
    sinceMs,
    limit: options.limit,
  });
  return { schema: NEXUS_STATUS_SCHEMA, events: filtered };
}

export function renderStatusText(status: NexusStatusV1): string {
  const lines = [
    `wallet: ${status.wallet ?? "?"}`,
    `harness: ${status.harness ?? "?"}`,
    `dispatch: ${status.dispatch ?? "?"}`,
    `uptime: ${status.uptimeSecs ?? "?"}s`,
    `actions: ${status.actions.length}`,
  ];
  for (const action of status.actions.slice(-10)) {
    lines.push(`  ${action.actionId} ${action.state}`);
  }
  if (status.recentErrors.length > 0) {
    lines.push("recent errors:");
    for (const err of status.recentErrors) {
      lines.push(`  ${err.at} ${err.type}${err.message ? `: ${err.message}` : ""}`);
    }
  }
  return lines.join("\n");
}

export { formatSummary, estimateTokenCount, readActionSidecar, sidecarPathForAction };
