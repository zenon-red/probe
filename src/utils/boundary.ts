import type { OutputResult } from "~/types/index.js";
import { ProbeError } from "~/utils/errors.js";
import { isJsonMode } from "~/utils/output-mode.js";

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

const nativeProcessExit = process.exit.bind(process);

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
  renderProbeError(err);
  return nativeProcessExit(err.exitCode);
}

export function exitProcess(code: number): never {
  return nativeProcessExit(code);
}
