import type { OutputResult } from "~/types/index.js";
import { isCliError, isProbeError, ProbeError } from "~/utils/errors.js";
import { isJsonMode } from "~/utils/output-mode.js";

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

const nativeProcessExit = process.exit.bind(process);

function renderFormattedError(code: string, message: string, suggestion?: string): void {
  if (isJsonMode()) {
    const output: OutputResult<never> = {
      success: false,
      error: {
        code,
        message,
        ...(suggestion && { suggestion }),
      },
    };
    console.error(JSON.stringify(output, jsonReplacer, 2));
    return;
  }

  console.error(`${code}: ${message}`);
  if (suggestion) {
    console.error(`hint: ${suggestion}`);
  }
}

export function renderProbeError(err: ProbeError): void {
  renderFormattedError(err.code, err.message, err.suggestion);
}

export function renderProbeErrorAndExit(err: ProbeError): never {
  renderProbeError(err);
  return nativeProcessExit(err.exitCode);
}

export function renderCliErrorAndExit(err: Error & { code: string }): never {
  renderFormattedError(err.code, err.message);
  return nativeProcessExit(1);
}

export function renderBoundaryErrorAndExit(err: unknown): void {
  if (isProbeError(err)) {
    renderProbeErrorAndExit(err);
  }
  if (isCliError(err)) {
    renderCliErrorAndExit(err);
  }
}

export function exitProcess(code: number): never {
  return nativeProcessExit(code);
}
