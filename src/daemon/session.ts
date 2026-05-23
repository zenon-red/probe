import type { ChildProcess } from "node:child_process";
import { enumName } from "~/utils/enums.js";
import { HEARTBEAT } from "~/utils/timeouts.js";
import { callReducer, type CommandContext } from "~/utils/context.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { createActionExecutor, type IssuedAction } from "./action-executor.js";
import { sanitizeValue, type EventEmitter } from "./events.js";
import type { SpawnRunner } from "./harness-runner.js";

export type SessionEnd = {
  reason: "disconnected" | "heartbeat_failed" | "stop" | "harness_error";
  details?: unknown;
};

type ObservableTable = {
  onInsert?: (cb: (_ctx: unknown, row: unknown) => void) => void;
  onUpdate?: (cb: (_ctx: unknown, oldRow: unknown, newRow: unknown) => void) => void;
  onDelete?: (cb: (_ctx: unknown, row: unknown) => void) => void;
};

export type DaemonSessionOptions = {
  ctx: CommandContext;
  harness: HarnessDetectionResult;
  emit: EventEmitter;
  effectiveWallet: string | null;
  resolvedHost: string;
  resolvedModule: string;
  logFile: string | null;
  logLevel: string;
  stopping: () => boolean;
  stopWaiter: Promise<void>;
  sleep: (ms: number) => Promise<void>;
  withJitter: (baseMs: number) => number;
  spawnFn?: SpawnRunner;
};

export async function runDaemonSession(options: DaemonSessionOptions): Promise<SessionEnd | null> {
  let sessionEnd: SessionEnd | null = null;

  emitReadyState(options);

  const currentAgent = options.ctx.agents[0];
  if (!currentAgent) {
    options.emit({ type: "auth_failed", message: "Agent not found. Are you registered?" });
    return { reason: "stop" };
  }

  const agentId = currentAgent.id as string;
  await subscribeToActions(options.ctx, agentId);

  options.emit({
    type: "ready",
    identity: options.ctx.identity?.toHexString(),
    wallet: options.effectiveWallet,
    harness: options.harness.harness,
    log_file: options.logFile,
    log_level: options.logLevel,
  });

  let runningHarness: ChildProcess | null = null;
  let runningActionId: number | null = null;

  const executeAction = createActionExecutor({
    ctx: options.ctx,
    harness: options.harness,
    emit: options.emit,
    setRunningHarness: (child) => {
      runningHarness = child;
    },
    setRunningActionId: (id) => {
      runningActionId = id;
    },
    spawnFn: options.spawnFn,
  });

  const actionsTable = options.ctx.db["agent_actions"] as ObservableTable;
  actionsTable.onInsert?.((_ctx, row) => {
    const action = row as unknown as IssuedAction;
    if (enumName(action.status) !== "Issued") return;
    if (action.agentId !== agentId) return;

    options.emit({ type: "action_received", action_id: action.id, kind: enumName(action.kind) });

    if (runningHarness) {
      options.emit({
        type: "harness_spawn_violation",
        action_id: action.id,
        running_action_id: runningActionId,
      });
      return;
    }

    executeAction(action);
  });

  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleHeartbeat = () => {
    if (options.stopping()) return;
    heartbeatTimer = setTimeout(async () => {
      if (options.stopping()) return;
      try {
        await callReducer(options.ctx, options.ctx.conn.reducers.heartbeat, { agentId });
      } catch {
        // non-fatal — heartbeat is liveness proof only
      }
      scheduleHeartbeat();
    }, options.withJitter(HEARTBEAT.INTERVAL_MS));
  };

  scheduleHeartbeat();

  while (!options.stopping() && !sessionEnd) {
    await Promise.race([options.stopWaiter, options.sleep(200)]);
  }

  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  (runningHarness as ChildProcess | null)?.kill("SIGTERM");
  runningHarness = null;

  return sessionEnd;
}

function emitReadyState(options: DaemonSessionOptions): void {
  options.emit({ type: "subscription_applied" });
}

async function subscribeToActions(ctx: CommandContext, agentId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error(`Invalid agentId: ${agentId}`);
    }
    ctx.conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((err) =>
        reject(new Error(`Action subscription error: ${err.event?.message || "Unknown error"}`)),
      )
      .subscribe([
        // NOTE: cannot filter on enum column `status` in SQL (SpacetimeDB does not
        // support enum literals in WHERE). Client-side onInsert handler filters by
        // checking `enumName(action.status) !== "Issued"`.
        `SELECT * FROM agent_actions WHERE agent_id = '${agentId}'`,
      ]);
  });
}

export function connectErrorLooksAuthRelated(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("authentication required") ||
    lowered.includes("unauthorized") ||
    lowered.includes("401")
  );
}

export function createSessionEndSetter(
  getSessionEnd: () => SessionEnd | null,
  setSessionEnd: (end: SessionEnd) => void,
): (...disconnectArgs: unknown[]) => void {
  return (...disconnectArgs: unknown[]) => {
    if (!getSessionEnd()) {
      setSessionEnd({
        reason: "disconnected",
        details: disconnectArgs.map(sanitizeValue),
      });
    }
  };
}
