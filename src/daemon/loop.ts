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
  createEventEmitter,
  resolveLogLevel,
  resolveLogStream,
  sanitizeValue,
  type EventEmitter,
  type LogLevel,
} from "./events.js";
import type { SpawnRunner } from "./harness-runner.js";

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
  spawnFn?: SpawnRunner;
  sleepFn?: (ms: number) => Promise<void>;
  backoffMsFn?: (attempt: number) => number;
};

export async function runDaemonLoop(options: RunDaemonLoopOptions): Promise<void> {
  const args = options.args;
  const logLevel = resolveLogLevel(args["log-level"]);
  const withAuthImpl = options.withAuthFn ?? withAuth;
  const getConfigFn = options.getConfigFn ?? getConfig;
  const resolveLogStreamFn = options.resolveLogStreamFn ?? resolveLogStream;
  const sleepFn = options.sleepFn ?? sleep;
  const backoffMsFn = options.backoffMsFn ?? backoffMs;
  const runDaemonSessionFn = options.runDaemonSessionFn ?? runDaemonSession;

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

  let logStream: WriteStream | null = null;
  try {
    logStream = await resolveLogStreamFn(args["log-file"] as string | undefined);
  } catch (err) {
    console.error(`Log file error: ${normalizeError(err)}`);
    return;
  }

  const emit = createEventEmitter({ logLevel, logStream });

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
              return [`SELECT * FROM agents WHERE identity = '${idHex}'`];
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
          reconnectAttempt = 0;
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
            stopping: () => stopping,
            stopWaiter,
            sleep: sleepFn,
            withJitter: (baseMs) => withJitter(baseMs),
            spawnFn: options.spawnFn,
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

    if (stopping) break;

    const reason = sessionEnd?.reason || "disconnected";
    emit({ type: "disconnected", reason, details: sanitizeValue(sessionEnd?.details || null) });

    if (downtimeStartedAt === null) downtimeStartedAt = Date.now();

    reconnectAttempt += 1;
    const waitMs = backoffMsFn(reconnectAttempt);
    emit({ type: "reconnecting", attempt: reconnectAttempt, backoff_ms: waitMs });

    await Promise.race([stopWaiter, sleepFn(waitMs)]);
  }

  emit({ type: "shutdown", signal: stopSignal || "unknown" });
  if (logStream) logStream.end();
}

export async function runNexusDaemon(args: Record<string, unknown>): Promise<void> {
  await runDaemonLoop({ args });
}

export type { EventEmitter, LogLevel, SessionEnd };
