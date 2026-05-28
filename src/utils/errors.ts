/*
 * process.exit inventory (src/) — see docs/internal/process-exit-inventory.md
 *
 * Intentional boundary exits:
 *   src/utils/boundary.ts       — renderProbeErrorAndExit, exitProcess
 *   src/index.ts                — top-level command and rejection boundary
 *   src/commands/doctor.ts      — exitProcess(1) after success output when checks fail
 *   src/commands/nexus-daemon.ts — renderProbeErrorAndExit on harness startup failure
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

export const isCliError = (err: unknown): err is Error & { code: string } =>
  err instanceof Error && err.name === "CLIError" && "code" in err && typeof err.code === "string";

export const isConnectionLikeError = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return CONNECTION_ERROR_MARKERS.some((marker) => lowered.includes(marker));
};

export const failWithConnectionOrUnexpected = (err: unknown): never => {
  if (isProbeError(err)) throw err;
  const message = errorMessage(err, "Unknown error");
  const code = isConnectionLikeError(message) ? "CONNECTION_ERROR" : "UNEXPECTED_ERROR";
  throw ProbeError.of(code, message);
};

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (fallback) return fallback;
  return String(err);
}
