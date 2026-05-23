import type { OutputResult } from "~/types/index.js";
import { ProbeError, takeProbeErrorForExit, clearProbeErrorForExit } from "~/utils/errors.js";
import { isJsonMode } from "~/utils/output-mode.js";

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

const nativeProcessExit = process.exit.bind(process);

export function installProbeExitHook(): void {
  process.exit = ((code?: number) => {
    const pending = takeProbeErrorForExit();
    if (pending) {
      renderProbeError(pending);
      nativeProcessExit(pending.exitCode);
      return undefined as never;
    }
    nativeProcessExit(code);
    return undefined as never;
  }) as typeof process.exit;
}

export function renderProbeError(err: ProbeError): void {
  if (isJsonMode()) {
    const output: OutputResult<never> = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.suggestion && { suggestion: err.suggestion }),
      },
    };
    console.error(JSON.stringify(output, jsonReplacer, 2));
    return;
  }

  console.error(`${err.code}: ${err.message}`);
  if (err.suggestion) {
    console.error(`hint: ${err.suggestion}`);
  }
}

export function renderProbeErrorAndExit(err: ProbeError): never {
  clearProbeErrorForExit();
  renderProbeError(err);
  return nativeProcessExit(err.exitCode);
}

export function exitProcess(code: number): never {
  clearProbeErrorForExit();
  return nativeProcessExit(code);
}

export { clearProbeErrorForExit } from "~/utils/errors.js";
