import type { WriteStream } from "node:fs";
import {
  autoDetectHarness,
  detectHarnesses,
  type HarnessDetectionResult,
} from "~/utils/harness-detection.js";
import { renderProbeErrorAndExit } from "~/utils/boundary.js";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { getConfig, resolveSpacetimeArgs } from "~/utils/config.js";
import { ProbeError } from "~/utils/errors.js";
import { HEARTBEAT, RECONNECT } from "~/utils/timeouts.js";
import {
  connectErrorLooksAuthRelated,
  createSessionEndSetter,
  runDaemonSession,
  type SessionEnd,
} from "./session.js";
import {
  createEventBus,
  resolveLogLevel,
  resolveLogStream,
  sanitizeValue,
  type DaemonEvent,
  type EventBus,
  type EventEmitter,
  type LogLevel,
} from "./events.js";
import { isAdapterHarness, resolveAdapterLaunch } from "~/acp/agents/adapter-registry.js";
import { mountNexusTui, runReplayTui, type NexusTuiHandle } from "./tui/render.js";
import type { RunAcpSessionOptions } from "~/acp/run-action.js";
import type { AcpRunResult } from "~/acp/types.js";
import { acquireDaemonIpcLock, DaemonAlreadyRunningError } from "./ipc-lock.js";
import { nexusAuditLogPath } from "./audit-paths.js";

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
    description: "Harness override: auto, pi, hermes, openclaw, opencode, claude, codex, custom",
  },
  replay: {
    type: "string",
    description: "Render TUI from recorded JSONL without connecting to STDB",
  },
  json: {
    type: "boolean",
    description: "Reserved for CLI consistency",
    default: false,
  },
} as const;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const withJitter = (baseMs: number, random = (): number => Math.random()): number => {
  const jitter = Math.floor(random() * (HEARTBEAT.JITTER_MS * 2 + 1) - HEARTBEAT.JITTER_MS);
  return Math.max(1_000, baseMs + jitter);
};

export const backoffMs = (attempt: number, random = (): number => Math.random()): number => {
  const base = Math.min(RECONNECT.MAX_MS, RECONNECT.BASE_MS * 2 ** Math.max(0, attempt - 1));
  return withJitter(base, random);
};

const normalizeError = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

export type ResolveHarnessOptions = {
  harnessArg?: unknown;
  config: Awaited<ReturnType<typeof getConfig>>;
  detectHarnessesFn?: typeof detectHarnesses;
  autoDetectHarnessFn?: typeof autoDetectHarness;
};

export function resolveHarness(options: ResolveHarnessOptions): HarnessDetectionResult {
  const detect = options.detectHarnessesFn ?? detectHarnesses;
  const autoDetect = options.autoDetectHarnessFn ?? autoDetectHarness;

  if (options.harnessArg && options.harnessArg !== "auto") {
    const explicit = options.harnessArg as string;
    if (explicit === "custom") {
      return {
        harness: "custom",
        command: options.config.harnessCommand || "",
        args: options.config.harnessArgs || [],
      };
    }
    if (explicit === "claude" || explicit === "codex" || explicit === "pi") {
      return { harness: explicit, command: "", args: [] };
    }
    const match = detect().find((d) => d.harness === explicit);
    if (!match) throw new Error(`Harness "${explicit}" not detected.`);
    return match;
  }

  return autoDetect();
}

export type RunDaemonLoopOptions = {
  args: Record<string, unknown>;
  withAuthFn?: typeof withAuth;
  getConfigFn?: typeof getConfig;
  resolveLogStreamFn?: typeof resolveLogStream;
  runDaemonSessionFn?: typeof runDaemonSession;
  runAcpSession?: (options: RunAcpSessionOptions) => Promise<AcpRunResult>;
  sleepFn?: (ms: number) => Promise<void>;
  backoffMsFn?: (attempt: number) => number;
  acquireDaemonIpcLockFn?: typeof acquireDaemonIpcLock;
};

type DaemonEventSurface = {
  bus: EventBus;
  emit: EventEmitter;
  logStream: WriteStream | null;
  close: () => void;
};

type StopController = {
  stopping: () => boolean;
  signal: () => "SIGINT" | "SIGTERM" | null;
  waiter: Promise<void>;
  dispose: () => void;
};

async function createDaemonEventSurface(options: {
  args: Record<string, unknown>;
  wallet: string;
  logLevel: LogLevel;
  resolveLogStreamFn: typeof resolveLogStream;
  publish?: (event: DaemonEvent) => void;
}): Promise<DaemonEventSurface> {
  const logPath =
    (options.args["log-file"] as string | undefined) ?? nexusAuditLogPath(options.wallet);
  const logStream = await options.resolveLogStreamFn(logPath);
  const renderTui = process.stderr.isTTY;
  const stdoutFeedsTerminal = process.stdout.isTTY;
  const writeJsonlToStdout = Boolean(options.args.json) || !(renderTui && stdoutFeedsTerminal);
  const bus = createEventBus({
    logLevel: options.logLevel,
    logStream,
    write: writeJsonlToStdout ? undefined : () => {},
  });
  if (options.publish) bus.subscribe(options.publish);

  return {
    bus,
    emit: bus.emit,
    logStream,
    close: () => {
      if (logStream) logStream.end();
    },
  };
}

function createStopController(): StopController {
  let stopping = false;
  let stopSignal: "SIGINT" | "SIGTERM" | null = null;
  let resolveWaiter: (() => void) | undefined;
  const waiter = new Promise<void>((resolve) => {
    resolveWaiter = resolve;
  });
  const requestStop = (signal: "SIGINT" | "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    stopSignal = signal;
    resolveWaiter?.();
  };
  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return {
    stopping: () => stopping,
    signal: () => stopSignal,
    waiter,
    dispose: () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}

export async function runDaemonLoop(options: RunDaemonLoopOptions): Promise<void> {
  const args = options.args;
  const logLevel = resolveLogLevel(args["log-level"]);
  const withAuthImpl = options.withAuthFn ?? withAuth;
  const getConfigFn = options.getConfigFn ?? getConfig;
  const resolveLogStreamFn = options.resolveLogStreamFn ?? resolveLogStream;
  const sleepFn = options.sleepFn ?? sleep;
  const backoffMsFn = options.backoffMsFn ?? backoffMs;
  const runDaemonSessionFn = options.runDaemonSessionFn ?? runDaemonSession;
  const acquireDaemonIpcLockFn = options.acquireDaemonIpcLockFn ?? acquireDaemonIpcLock;

  const config = await getConfigFn();
  const { host: resolvedHost, module: resolvedModule } = resolveSpacetimeArgs(
    { host: args.host as string | undefined, module: args.module as string | undefined },
    config,
  );

  let harness: HarnessDetectionResult;
  try {
    harness = resolveHarness({ harnessArg: args.harness, config });
  } catch (err) {
    renderProbeErrorAndExit(ProbeError.of("HARNESS_DETECTION_FAILED", normalizeError(err)));
  }

  const replayPath = args.replay as string | undefined;
  if (replayPath) {
    await runReplayTui(replayPath);
    return;
  }

  let releaseDaemonIpcLock: (() => Promise<void>) | undefined;
  const lockWallet = (args.wallet as string | undefined) || config.defaultWallet || "default";
  let ipcPublish: ((event: DaemonEvent) => void) | undefined;
  try {
    const lock = await acquireDaemonIpcLockFn(lockWallet);
    releaseDaemonIpcLock = lock.release;
    ipcPublish = lock.publish;
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      renderProbeErrorAndExit(ProbeError.of("DAEMON_ALREADY_RUNNING", err.message));
      return;
    }
    throw err;
  }

  let eventSurface: DaemonEventSurface | null = null;
  try {
    eventSurface = await createDaemonEventSurface({
      args,
      wallet: lockWallet,
      logLevel,
      resolveLogStreamFn,
      publish: ipcPublish,
    });
  } catch (err) {
    console.error(`Log file error: ${normalizeError(err)}`);
    await releaseDaemonIpcLock?.();
    return;
  }

  const emit = eventSurface.emit;
  let tuiHandle: NexusTuiHandle | null = null;
  let stop: StopController | null = null;

  try {
    if (isAdapterHarness(harness.harness)) {
      try {
        const resolved = await resolveAdapterLaunch(harness.harness);
        emit({
          type: "adapter_resolved",
          harness: harness.harness,
          registry_id: resolved.registryId,
          version: resolved.version,
          source: resolved.source,
        });
      } catch (err) {
        const message = normalizeError(err);
        renderProbeErrorAndExit(ProbeError.of("ADAPTER_RESOLVE_FAILED", message));
      }
    }

    if (process.stderr.isTTY && !args.json) {
      tuiHandle = mountNexusTui(eventSurface.bus, {
        initial: {
          harness: harness.harness,
          host: resolvedHost,
          module: resolvedModule,
          dispatch: "unknown",
        },
        wallet: args.wallet as string | undefined,
      });
    }

    stop = createStopController();
    const activeStop = stop;

    let reconnectAttempt = 0;
    let downtimeStartedAt: number | null = null;
    let hasConnectedOnce = false;

    while (!activeStop.stopping()) {
      let sessionEnd: SessionEnd | null = null;

      try {
        await withAuthImpl(
          commandContextOptions(
            {
              wallet: args.wallet as string | undefined,
              host: args.host as string | undefined,
              module: args.module as string | undefined,
            },
            {
              onDisconnect: createSessionEndSetter(
                () => sessionEnd,
                (end) => {
                  sessionEnd = end;
                },
              ),
              subscribeFactory: (identity) => {
                const idHex = identity.toHexString();
                if (!/^[0-9a-f]+$/.test(idHex)) throw new Error(`Invalid identity hex: ${idHex}`);
                return [
                  `SELECT * FROM agents WHERE identity = '${idHex}'`,
                  `SELECT * FROM config WHERE key = 'dispatch_enabled'`,
                ];
              },
            },
          ),
          async (ctx) => {
            const effectiveWallet = ctx.auth?.wallet || (args.wallet as string | undefined) || null;

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
            downtimeStartedAt = null;

            sessionEnd = await runDaemonSessionFn({
              ctx,
              harness,
              emit,
              effectiveWallet,
              resolvedHost,
              resolvedModule,
              logFile: (args["log-file"] as string | undefined) || null,
              logLevel,
              stopping: activeStop.stopping,
              stopWaiter: activeStop.waiter,
              sleep: sleepFn,
              withJitter: (baseMs) => withJitter(baseMs),
              runAcpSession: options.runAcpSession,
            });
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

      if (activeStop.stopping()) break;

      const reason = sessionEnd?.reason || "disconnected";
      emit({ type: "disconnected", reason, details: sanitizeValue(sessionEnd?.details || null) });

      if (downtimeStartedAt === null) downtimeStartedAt = Date.now();

      if (sessionEnd?.reason !== "auth_failed") {
        reconnectAttempt = 0;
      }
      reconnectAttempt += 1;
      const waitMs = backoffMsFn(reconnectAttempt);
      emit({ type: "reconnecting", attempt: reconnectAttempt, backoff_ms: waitMs });

      await Promise.race([activeStop.waiter, sleepFn(waitMs)]);
    }

    emit({ type: "shutdown", signal: activeStop.signal() || "unknown" });
  } finally {
    stop?.dispose();
    tuiHandle?.unmount();
    eventSurface?.close();
    await releaseDaemonIpcLock?.();
  }
}

export async function runNexusDaemon(args: Record<string, unknown>): Promise<void> {
  await runDaemonLoop({ args });
}

export type { EventBus, EventEmitter, LogLevel, SessionEnd };
