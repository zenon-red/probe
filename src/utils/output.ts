import { emit } from "./emit.js";
import { ProbeError } from "./errors.js";

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
  throw ProbeError.of(code, message, suggestion, exitCode);
}
