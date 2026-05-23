// TODO: add unit tests for executeAction harness lifecycle (mock ChildProcess) and reconnection backoff
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { defineCommand } from "citty";
import { callReducer, withAuth } from "~/utils/context.js";
import { enumName } from "~/utils/enums.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import {
  autoDetectHarness,
  detectHarnesses,
  type HarnessDetectionResult,
} from "~/utils/harness-detection.js";
import { buildActionPrompt } from "~/utils/prompt-builder.js";

import { HARNESS_TIMEOUT_SECS, HEARTBEAT, RECONNECT } from "~/utils/timeouts.js";
import { getConfig, resolveSpacetimeArgs } from "~/utils/config.js";

type DaemonEvent = {
  type: string;
  source: "nexus";
  at: string;
  [key: string]: unknown;
};

type SessionEnd = {
  reason: "disconnected" | "heartbeat_failed" | "stop" | "harness_error";
  details?: unknown;
};

type LogLevel = "critical" | "info" | "debug";

type ObservableTable = {
  onInsert?: (cb: (_ctx: unknown, row: unknown) => void) => void;
  onUpdate?: (cb: (_ctx: unknown, oldRow: unknown, newRow: unknown) => void) => void;
  onDelete?: (cb: (_ctx: unknown, row: unknown) => void) => void;
};

const CRITICAL_EVENTS = new Set([
  "connected",
  "ready",
  "disconnected",
  "reconnecting",
  "reconnected",
  "subscription_applied",
  "subscription_error",
  "auth_failed",
  "heartbeat_failed",
  "heartbeat_recovered",
  "shutdown",
  "action_received",
  "action_started",
  "action_completed",
  "action_failed_infra",
  "harness_spawn_violation",
]);

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  return value;
};

const nowIso = (): string => new Date().toISOString();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withJitter = (baseMs: number): number => {
  const jitter = Math.floor(Math.random() * (HEARTBEAT.JITTER_MS * 2 + 1) - HEARTBEAT.JITTER_MS);
  return Math.max(1_000, baseMs + jitter);
};

const backoffMs = (attempt: number): number => {
  const base = Math.min(RECONNECT.MAX_MS, RECONNECT.BASE_MS * 2 ** Math.max(0, attempt - 1));
  return withJitter(base);
};

const normalizeError = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

const sanitizeValue = (value: unknown): unknown => {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.parse(JSON.stringify(value, jsonReplacer));
  } catch {
    return String(value);
  }
};

const resolveLogLevel = (value: unknown): LogLevel => {
  if (value === "critical" || value === "info" || value === "debug") return value;
  return "critical";
};

const shouldEmit = (eventType: string, level: LogLevel): boolean => {
  if (level === "debug") return true;
  if (CRITICAL_EVENTS.has(eventType)) return true;
  if (level === "info" && eventType.startsWith("heartbeat_")) return true;
  return false;
};

const resolveLogStream = async (pathValue?: string): Promise<WriteStream | null> => {
  if (!pathValue) return null;
  const absolutePath = resolve(pathValue);
  await mkdir(dirname(absolutePath), { recursive: true });
  return createWriteStream(absolutePath, { flags: "a" });
};

const connectErrorLooksAuthRelated = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("authentication required") ||
    lowered.includes("unauthorized") ||
    lowered.includes("401")
  );
};

type AgentRunOutcome = "Clean" | "Signal" | "Timeout" | "SpawnFailed";

interface IssuedAction {
  id: number;
  agentId: string;
  kind: unknown;
  skill?: string;
  instruction?: string;
  route?: unknown;
  targetType?: string | null;
  targetId?: string | null;
  triggerType?: string | null;
  triggerId?: string | null;
  status: unknown;
}

function buildHarnessSpawnArgs(harness: HarnessDetectionResult, prompt: string): string[] {
  if (harness.harness === "pi") return ["pi", "-p", prompt];
  if (harness.harness === "hermes") return ["hermes", "-z", prompt];
  if (harness.harness === "openclaw") return ["openclaw", "agent", "-m", prompt, "--json"];
  if (harness.harness === "opencode") return ["opencode", "run", prompt];
  // custom
  return [harness.command, ...harness.args, prompt];
}

export const nexusDaemonArgs = {
  wallet: {
    type: "string",
    description: "Wallet name for authenticated connection",
  },
  host: {
    type: "string",
    description: "SpacetimeDB host override",
  },
  module: {
    type: "string",
    description: "SpacetimeDB module override",
  },
  "log-file": {
    type: "string",
    description: "Optional path to append JSONL daemon events",
  },
  "log-level": {
    type: "string",
    description: "critical, info, or debug",
    default: "critical",
  },
  harness: {
    type: "string",
    description: "Harness override: auto, pi, hermes, openclaw, opencode, custom",
  },
  json: {
    type: "boolean",
    description: "Reserved for CLI consistency",
    default: false,
  },
} as const;

export async function runNexusDaemon(args: Record<string, unknown>): Promise<void> {
  const logLevel = resolveLogLevel(args["log-level"]);

  // Resolve harness and connection args upfront
  const config = await getConfig();
  const { host: resolvedHost, module: resolvedModule } = resolveSpacetimeArgs(
    { host: args.host as string | undefined, module: args.module as string | undefined },
    config,
  );

  let harness: HarnessDetectionResult;
  try {
    if (args.harness && args.harness !== "auto") {
      const explicit = args.harness as string;
      if (explicit === "custom") {
        harness = {
          harness: "custom",
          command: config.harnessCommand || "",
          args: config.harnessArgs || [],
        };
      } else {
        const detected = detectHarnesses();
        const match = detected.find((d) => d.harness === explicit);
        if (!match) throw new Error(`Harness "${explicit}" not detected.`);
        harness = match;
      }
    } else {
      harness = autoDetectHarness();
    }
  } catch (err) {
    console.error(`Harness detection failed: ${normalizeError(err)}`);
    process.exit(1);
  }

  let logStream: WriteStream | null = null;
  try {
    logStream = await resolveLogStream(args["log-file"] as string | undefined);
  } catch (err) {
    console.error(`Log file error: ${normalizeError(err)}`);
    return;
  }

  const writeEvent = (event: DaemonEvent): void => {
    const line = JSON.stringify(event, jsonReplacer);
    console.log(line);
    if (logStream) logStream.write(`${line}\n`);
  };

  const emit = (event: { type: string; [key: string]: unknown }): void => {
    if (!shouldEmit(event.type, logLevel)) return;
    const fullEvent: DaemonEvent = { source: "nexus", at: nowIso(), ...event };
    writeEvent(fullEvent);
  };

  let stopping = false;
  let stopSignal: "SIGINT" | "SIGTERM" | null = null;

  const stopWaiter = new Promise<void>((resolve) => {
    const onSigint = () => {
      if (!stopping) {
        stopping = true;
        stopSignal = "SIGINT";
        resolve();
      }
    };
    const onSigterm = () => {
      if (!stopping) {
        stopping = true;
        stopSignal = "SIGTERM";
        resolve();
      }
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });

  let reconnectAttempt = 0;
  let downtimeStartedAt: number | null = null;
  let hasConnectedOnce = false;

  while (!stopping) {
    let sessionEnd: SessionEnd | null = null;

    try {
      await withAuth(
        {
          wallet: args.wallet as string | undefined,
          onDisconnect: (...disconnectArgs: unknown[]) => {
            if (!sessionEnd) {
              sessionEnd = { reason: "disconnected", details: disconnectArgs.map(sanitizeValue) };
            }
          },
          // Narrow subscriptions: own agent + own issued actions
          subscribeFactory: (identity) => {
            const idHex = identity.toHexString();
            if (!/^[0-9a-f]+$/.test(idHex)) throw new Error(`Invalid identity hex: ${idHex}`);
            return [`SELECT * FROM agents WHERE identity = '${idHex}'`];
          },
        },
        async (ctx) => {
          const effectiveWallet = ctx.auth?.wallet || args.wallet || null;

          if (!hasConnectedOnce) {
            emit({
              type: "connected",
              identity: ctx.identity?.toHexString(),
              wallet: effectiveWallet,
              host: resolvedHost,
              module: resolvedModule,
            });
          } else {
            emit({
              type: "reconnected",
              attempts: reconnectAttempt,
              downtime_ms: downtimeStartedAt ? Date.now() - downtimeStartedAt : null,
              identity: ctx.identity?.toHexString(),
            });
          }

          hasConnectedOnce = true;
          reconnectAttempt = 0;
          downtimeStartedAt = null;

          emit({ type: "subscription_applied" });

          // Find own agent
          const db = ctx.db as Record<
            string,
            { iter?: () => IterableIterator<Record<string, unknown>> }
          >;
          const agents = db["agents"]?.iter ? Array.from(db["agents"].iter!()) : [];
          const currentAgent = agents[0]; // narrow subscription guarantees only own agent

          if (!currentAgent) {
            emit({ type: "auth_failed", message: "Agent not found. Are you registered?" });
            sessionEnd = { reason: "stop" };
            return;
          }

          const agentId = currentAgent.id as string;

          await new Promise<void>((resolve, reject) => {
            if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {
              throw new Error(`Invalid agentId: ${agentId}`);
            }
            ctx.conn
              .subscriptionBuilder()
              .onApplied(() => resolve())
              .onError((err) =>
                reject(
                  new Error(`Action subscription error: ${err.event?.message || "Unknown error"}`),
                ),
              )
              .subscribe([
                // NOTE: cannot filter on enum column `status` in SQL (SpacetimeDB does not
                // support enum literals in WHERE). Client-side onInsert handler filters by
                // checking `enumName(action.status) !== "Issued"`.
                `SELECT * FROM agent_actions WHERE agent_id = '${agentId}'`,
              ]);
          });

          emit({
            type: "ready",
            identity: ctx.identity?.toHexString(),
            wallet: effectiveWallet,
            harness: harness.harness,
            log_file: args["log-file"] || null,
            log_level: logLevel,
          });

          // --- Harness execution state ---
          let runningHarness: ChildProcess | null = null;
          let runningActionId: number | null = null;

          // Monitor agent_actions for new Issued actions
          const actionsTable = ctx.db["agent_actions"] as ObservableTable;
          actionsTable.onInsert?.((_ctx, row) => {
            const action = row as unknown as IssuedAction;
            if (enumName(action.status) !== "Issued") return;
            if (action.agentId !== agentId) return;

            emit({ type: "action_received", action_id: action.id, kind: enumName(action.kind) });

            if (runningHarness) {
              emit({
                type: "harness_spawn_violation",
                action_id: action.id,
                running_action_id: runningActionId,
              });
              return;
            }

            executeAction(action);
          });

          async function executeAction(action: IssuedAction): Promise<void> {
            runningActionId = action.id;

            // Build prompt
            const actionKind = enumName(action.kind);
            const prompt = buildActionPrompt({
              id: action.id,
              kind: actionKind,
              skill: action.skill || actionKind.toLowerCase(),
              instruction: action.instruction || `Execute ${actionKind}`,
              route: enumName(action.route),
              targetType: action.targetType,
              targetId: action.targetId,
              triggerType: action.triggerType,
            });

            // Report run_started_at
            try {
              await callReducer(ctx, ctx.conn.reducers.reportActionRunStarted, {
                actionId: BigInt(action.id),
                harness: harness.harness,
              });
            } catch {
              // non-fatal
            }

            emit({ type: "action_started", action_id: action.id, harness: harness.harness });

            const spawnArgs = buildHarnessSpawnArgs(harness, prompt);
            const command = spawnArgs[0];
            const commandArgs = spawnArgs.slice(1);
            const timeoutSecs = ctx.config.harnessTimeoutSecs ?? HARNESS_TIMEOUT_SECS;
            const startTime = Date.now();

            let outcome: AgentRunOutcome = "SpawnFailed";
            let timedOut = false;

            try {
              const result = await new Promise<{ exitCode: number | null; signal: string | null }>(
                (resolve, reject) => {
                  const child = spawn(command, commandArgs, { shell: false, stdio: "pipe" });
                  runningHarness = child;

                  let settled = false;
                  const settle = (result: { exitCode: number | null; signal: string | null }) => {
                    if (settled) return;
                    settled = true;
                    runningHarness = null;
                    resolve(result);
                  };

                  const timeout =
                    timeoutSecs > 0
                      ? setTimeout(() => {
                          timedOut = true;
                          child.kill("SIGKILL");
                          settle({ exitCode: null, signal: "SIGKILL" });
                        }, timeoutSecs * 1000)
                      : null;

                  child.on("close", (code, signal) => {
                    if (timeout) clearTimeout(timeout);
                    settle({ exitCode: code, signal });
                  });

                  child.on("error", (err) => {
                    if (timeout) clearTimeout(timeout);
                    runningHarness = null;
                    settled = true;
                    reject(err);
                  });
                },
              );

              if (timedOut) {
                outcome = "Timeout";
              } else if (result.exitCode === 0) {
                outcome = "Clean";
              } else {
                outcome = "Signal";
              }
            } catch {
              outcome = "SpawnFailed";
            }

            const durationSecs = Math.round((Date.now() - startTime) / 1000);

            // Report run metadata
            try {
              await callReducer(ctx, ctx.conn.reducers.reportActionRunFinished, {
                actionId: BigInt(action.id),
                outcome: { tag: outcome },
                durationSecs: BigInt(durationSecs),
              });
            } catch {
              // non-fatal
            }

            const eventActionId = runningActionId;
            runningActionId = null;

            if (outcome === "Clean") {
              emit({
                type: "action_completed",
                action_id: eventActionId,
                outcome,
                duration_secs: durationSecs,
              });
            } else {
              emit({
                type: "action_failed_infra",
                action_id: eventActionId,
                outcome,
                duration_secs: durationSecs,
              });
            }
          }

          // --- Heartbeat timer (5 min) ---
          let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

          const scheduleHeartbeat = () => {
            if (stopping) return;
            heartbeatTimer = setTimeout(async () => {
              if (stopping) return;
              try {
                await callReducer(ctx, ctx.conn.reducers.heartbeat, { agentId });
              } catch {
                // non-fatal — heartbeat is liveness proof only
              }
              scheduleHeartbeat();
            }, withJitter(HEARTBEAT.INTERVAL_MS));
          };

          scheduleHeartbeat();

          // --- Main loop ---
          while (!stopping && !sessionEnd) {
            await Promise.race([stopWaiter, sleep(200)]);
          }

          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          (runningHarness as ChildProcess | null)?.kill("SIGTERM");
          runningHarness = null;
        },
      );
    } catch (err) {
      const message = normalizeError(err);
      if (connectErrorLooksAuthRelated(message)) {
        emit({ type: "auth_failed", message });
        break;
      }
      emit({ type: "subscription_error", message });
      sessionEnd = { reason: "disconnected", details: { message } };
    }

    if (stopping) break;

    const reason = sessionEnd?.reason || "disconnected";
    emit({ type: "disconnected", reason, details: sanitizeValue(sessionEnd?.details || null) });

    if (downtimeStartedAt === null) downtimeStartedAt = Date.now();

    reconnectAttempt += 1;
    const waitMs = backoffMs(reconnectAttempt);
    emit({ type: "reconnecting", attempt: reconnectAttempt, backoff_ms: waitMs });

    await Promise.race([stopWaiter, sleep(waitMs)]);
  }

  emit({ type: "shutdown", signal: stopSignal || "unknown" });
  if (logStream) logStream.end();
}

export default defineCommand({
  meta: {
    name: "nexus",
    description: "Persistent Nexus daemon — action executor with narrow subscriptions",
  },
  args: nexusDaemonArgs,
  async run({ args }) {
    if (forceHelpRequested()) {
      printHelp({
        command: "probe nexus",
        description:
          "Run persistent Nexus daemon — receives dispatched actions and executes via harness",
        usage: [
          "probe nexus [options]",
          "probe nexus --wallet agent-wallet",
          "probe nexus --wallet agent-wallet --log-file ./logs/nexus-events.jsonl",
          "probe nexus --harness opencode",
        ],
        options: [
          { name: "--wallet", detail: "Wallet for authenticated persistent connection" },
          { name: "--host, --module", detail: "Nexus SpacetimeDB target overrides" },
          {
            name: "--harness",
            detail: "Harness: auto (default), pi, hermes, openclaw, opencode, custom",
          },
          { name: "--log-level", detail: "critical (default), info, or debug" },
          { name: "--log-file", detail: "Optional JSONL file path for daemon events" },
        ],
        notes: [
          "stdout is JSONL only — structured daemon events for agents.",
          "The daemon subscribes to own agent + own issued actions only (narrow subscriptions).",
          "Heartbeat runs every 5 minutes. Actions are executed one at a time.",
        ],
      });
      return;
    }

    await runNexusDaemon(args as Record<string, unknown>);
  },
});
