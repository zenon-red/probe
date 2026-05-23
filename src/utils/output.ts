import { emit } from "./emit.js";
import { ProbeError, markProbeErrorForExit } from "./errors.js";

export { applyJsonMode, isJsonMode, setJsonMode } from "./output-mode.js";

export function success<T>(data: T, next_commands?: string[]): void {
  emit({ data, next_commands });
}

export function error(
  code: string,
  message: string,
  suggestion?: string,
  exitCode?: number,
): never {
  const err = ProbeError.of(code, message, suggestion, exitCode);
  markProbeErrorForExit(err);
  throw err;
}
