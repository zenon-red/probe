import type { OutputResult } from "~/types/index.js";
import { emit, exitCodeFor } from "./emit.js";
import { isJsonMode } from "./output-mode.js";

export { applyJsonMode, isJsonMode, setJsonMode } from "./output-mode.js";

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

const printJson = (value: unknown, stderr = false): void => {
  const serialized = JSON.stringify(value, jsonReplacer, 2);
  if (stderr) {
    console.error(serialized);
    return;
  }
  console.log(serialized);
};

export function success<T>(data: T, next_commands?: string[]): void {
  emit({ data, next_commands });
}

export function error(
  code: string,
  message: string,
  suggestion?: string,
  exitCode?: number,
): never {
  const resolvedExitCode = exitCode ?? exitCodeFor(code);

  if (isJsonMode()) {
    const output: OutputResult<never> = {
      success: false,
      error: {
        code,
        message,
        ...(suggestion && { suggestion }),
      },
    };
    printJson(output, true);
    process.exit(resolvedExitCode);
  }

  console.error(`${code}: ${message}`);
  if (suggestion) {
    console.error(`hint: ${suggestion}`);
  }
  process.exit(resolvedExitCode);
}
