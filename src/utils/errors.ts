/*
 * process.exit inventory (src/) — see docs/internal/process-exit-inventory.md
 *
 * Intentional boundary exits (shared renderer / hook):
 *   src/utils/boundary.ts     — renderProbeErrorAndExit, exitProcess, installProbeExitHook
 *   src/index.ts              — unhandledRejection → renderProbeErrorAndExit; citty via exit hook
 *   src/commands/doctor.ts      — exitProcess(1) after success output when checks fail (not ProbeError)
 *   src/commands/nexus-daemon.ts — renderProbeErrorAndExit on harness startup failure
 *
 * Citty integration: installProbeExitHook() intercepts process.exit when a ProbeError was thrown
 * so citty's runMain catch path renders JSON/text via renderProbeError before exiting.
 *
 * Migrated away from direct process.exit:
 *   src/utils/output.ts — error() throws ProbeError (render at boundary)
 */

import { exitCodeFor } from "~/utils/emit.js";

const CONNECTION_ERROR_MARKERS = [
  "connection",
  "subscription error",
  "authentication required",
  "unauthorized",
  "401",
  "econnrefused",
  "etimedout",
  "enotfound",
  "timeout",
];

let exitHookProbeError: ProbeError | undefined;

export function clearProbeErrorForExit(): void {
  exitHookProbeError = undefined;
}

export function markProbeErrorForExit(err: ProbeError): void {
  exitHookProbeError = err;
}

export function takeProbeErrorForExit(): ProbeError | undefined {
  const pending = exitHookProbeError;
  exitHookProbeError = undefined;
  return pending;
}

export class ProbeError extends Error {
  readonly code: string;
  readonly suggestion?: string;
  readonly exitCode: number;

  constructor(code: string, message: string, suggestion?: string, exitCode?: number) {
    super(message);
    this.name = "ProbeError";
    this.code = code;
    this.suggestion = suggestion;
    this.exitCode = exitCode ?? exitCodeFor(code);
  }

  static of(code: string, message: string, suggestion?: string, exitCode?: number): ProbeError {
    return new ProbeError(code, message, suggestion, exitCode);
  }
}

export const isProbeError = (err: unknown): err is ProbeError => err instanceof ProbeError;

export const isConnectionLikeError = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return CONNECTION_ERROR_MARKERS.some((marker) => lowered.includes(marker));
};

export const failWithConnectionOrUnexpected = (err: unknown): never => {
  if (isProbeError(err)) throw err;
  const message = errorMessage(err, "Unknown error");
  const code = isConnectionLikeError(message) ? "CONNECTION_ERROR" : "UNEXPECTED_ERROR";
  const probeErr = ProbeError.of(code, message);
  markProbeErrorForExit(probeErr);
  throw probeErr;
};

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (fallback) return fallback;
  return String(err);
}
