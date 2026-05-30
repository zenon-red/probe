import type { ChildProcess } from "node:child_process";
import { enumName } from "~/utils/enums.js";
import { HEARTBEAT } from "~/utils/timeouts.js";
import { callReducer, type CommandContext } from "~/utils/context.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { createActionExecutor, type ActionExecutorDeps } from "./action-executor.js";
import { ensureGenesisSyncedBeforeHarness } from "./genesis-gate.js";
import { toExecutableAction, type ExecutableAction } from "./executable-action.js";
import { sanitizeValue, type EventEmitter } from "./events.js";
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
  runAcpSession?: ActionExecutorDeps["runAcpSession"];
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
  let runningActionId: bigint | null = null;
  let busy = false;
  const queuedActions: ExecutableAction[] = [];

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
    runAcpSession: options.runAcpSession,
  });

  const abandonQueued = (reason: string) => {
    if (queuedActions.length === 0) return;
    options.emit({
      type: "action_queue_abandoned",
      reason,
      action_ids: queuedActions.map((a) => a.id.toString()),
    });
    queuedActions.length = 0;
  };

  const processActionQueue = async (first: ExecutableAction) => {
    let next: ExecutableAction | null = first;
    while (next) {
      const ok = await ensureGenesisSyncedBeforeHarness(options.ctx, options.emit);
      if (!ok) {
        queuedActions.unshift(next);
        abandonQueued("genesis_blocked");
        return;
      }

      await executeAction(next);
      next = queuedActions.shift() ?? null;
    }
  };

  const actionsTable = options.ctx.db["agent_actions"] as ObservableTable;
  actionsTable.onInsert?.((_ctx, row) => {
    const action = toExecutableAction(row);
    if (!action) return;
    if (action.agentId !== agentId) return;

    options.emit({
      type: "action_received",
      action_id: action.id.toString(),
      kind: enumName(action.kind),
    });

    if (busy) {
      queuedActions.push(action);
      options.emit({
        type: "action_queued",
        action_id: action.id.toString(),
        running_action_id: runningActionId?.toString() ?? null,
      });
      return;
    }

    busy = true;
    void processActionQueue(action).finally(() => {
      busy = false;
    });
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
  abandonQueued("shutdown");
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
        "SELECT * FROM applied_genesis",
        "SELECT * FROM agent_runtime_status",
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
