import type { DaemonEvent } from "./events.js";
import { NEXUS_STATUS_SCHEMA, type NexusStatusV1 } from "./status-schema.js";

export type DaemonActionProjection = {
  actionId: string;
  state: string;
  harness?: string;
};

export type DaemonProjection = {
  wallet?: string;
  host?: string;
  module?: string;
  harness?: string;
  identity?: string;
  dispatch: string;
  connectedAt?: string;
  uptimeSecs?: number;
  actions: DaemonActionProjection[];
  recentErrors: Array<{ at: string; type: string; message?: string }>;
  health: "healthy" | "degraded" | "reconnecting" | "auth failing";
  events: DaemonEvent[];
};

export type ProjectionContext = {
  wallet?: string;
  host?: string;
  module?: string;
  harness?: string;
  dispatch?: string;
  nowMs?: number;
  eventLimit?: number;
};

const DEFAULT_EVENT_LIMIT = 200;
const RECENT_ERROR_WINDOW_MS = 5 * 60_000;

function eventTimeMs(event: DaemonEvent): number {
  const parsed = Date.parse(String(event.at));
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventString(event: DaemonEvent | undefined, key: string): string | undefined {
  if (!event) return undefined;
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isDaemonErrorEvent(event: DaemonEvent, nowMs = Date.now()): boolean {
  const at = eventTimeMs(event);
  if (at > 0 && at < nowMs - RECENT_ERROR_WINDOW_MS) return false;
  return (
    event.type.includes("failed") ||
    event.type.includes("error") ||
    event.type === "auth_failed" ||
    event.type === "subscription_error"
  );
}

function actionStateForEvent(event: DaemonEvent): string | undefined {
  if (event.type === "action_received" || event.type === "action_started") return "running";
  if (event.type === "action_completed") return "completed";
  if (event.type === "action_failed_infra") return "failed";
  return undefined;
}

function healthFromEvents(
  events: DaemonEvent[],
  recentErrors: Array<{ at: string; type: string; message?: string }>,
): DaemonProjection["health"] {
  const latest = events.at(-1)?.type;
  if (latest === "auth_failed") return "auth failing";
  if (latest === "disconnected" || latest === "reconnecting") return "reconnecting";
  if (recentErrors.length > 0) return "degraded";
  return "healthy";
}

export function projectDaemonEvents(
  inputEvents: DaemonEvent[],
  context: ProjectionContext = {},
): DaemonProjection {
  const nowMs = context.nowMs ?? Date.now();
  const eventLimit = context.eventLimit ?? DEFAULT_EVENT_LIMIT;
  const events = eventLimit > 0 ? inputEvents.slice(-eventLimit) : [];
  const connected = [...inputEvents].reverse().find((event) => event.type === "connected");
  const ready = [...inputEvents].reverse().find((event) => event.type === "ready");
  const dispatchEvent = [...inputEvents]
    .reverse()
    .find((event) => event.type === "module_dispatch" && event.dispatch != null);
  const connectedAt = connected ? String(connected.at) : undefined;
  const uptimeSecs =
    connectedAt != null
      ? Math.max(0, Math.floor((nowMs - Date.parse(connectedAt)) / 1000))
      : undefined;

  const actions = new Map<string, DaemonActionProjection>();
  for (const event of inputEvents) {
    const actionId = event.action_id != null ? String(event.action_id) : undefined;
    if (!actionId) continue;
    const row = actions.get(actionId) ?? { actionId, state: "unknown", harness: context.harness };
    const state = actionStateForEvent(event);
    if (state) row.state = state;
    if (event.harness) row.harness = String(event.harness);
    actions.set(actionId, row);
  }

  const recentErrors = inputEvents
    .filter((event) => isDaemonErrorEvent(event, nowMs))
    .slice(-10)
    .map((event) => ({
      at: String(event.at),
      type: String(event.type),
      message: typeof event.message === "string" ? event.message : undefined,
    }));

  return {
    wallet: context.wallet ?? eventString(ready, "wallet") ?? eventString(connected, "wallet"),
    host: context.host ?? eventString(connected, "host"),
    module: context.module ?? eventString(connected, "module"),
    harness: context.harness ?? eventString(ready, "harness") ?? eventString(connected, "harness"),
    identity: eventString(connected, "identity")?.slice(0, 12),
    dispatch:
      dispatchEvent?.dispatch != null
        ? String(dispatchEvent.dispatch)
        : (context.dispatch ?? "unknown"),
    connectedAt,
    uptimeSecs,
    actions: [...actions.values()],
    recentErrors,
    health: healthFromEvents(inputEvents, recentErrors),
    events,
  };
}

export function projectionToStatus(projection: DaemonProjection): NexusStatusV1 {
  return {
    schema: NEXUS_STATUS_SCHEMA,
    wallet: projection.wallet,
    host: projection.host,
    module: projection.module,
    harness: projection.harness,
    dispatch: projection.dispatch,
    uptimeSecs: projection.uptimeSecs,
    actions: projection.actions,
    spend: {},
    recentErrors: projection.recentErrors,
    connectedAt: projection.connectedAt,
  };
}
