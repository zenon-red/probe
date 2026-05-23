import { encode } from "@toon-format/toon";
import { isJsonMode } from "./output-mode.js";

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC: 1,
  AUTH: 2,
  CONNECTION: 3,
  VALIDATION: 4,
  NOT_FOUND: 5,
} as const;

const AUTH_ERROR_CODES = new Set([
  "AUTH_REQUIRED",
  "AUTH_ERROR",
  "UNAUTHORIZED",
  "PASSWORD_REQUIRED",
  "MNEMONIC_REQUIRED",
  "WALLET_LOAD_ERROR",
  "ADDRESS_MISMATCH",
]);

const CONNECTION_ERROR_CODES = new Set([
  "CONNECTION_ERROR",
  "SQL_UNAVAILABLE",
  "SUBSCRIPTION_ERROR",
]);

const NOT_FOUND_ERROR_CODES = new Set([
  "WALLET_NOT_FOUND",
  "ACTION_NOT_FOUND",
  "NOT_REGISTERED",
  "NOT_FOUND",
  "NO_RELEASES_PUBLISHED",
]);

export function exitCodeFor(code: string): number {
  if (AUTH_ERROR_CODES.has(code)) return EXIT_CODES.AUTH;
  if (CONNECTION_ERROR_CODES.has(code)) return EXIT_CODES.CONNECTION;
  if (NOT_FOUND_ERROR_CODES.has(code) || code.endsWith("_NOT_FOUND")) {
    return EXIT_CODES.NOT_FOUND;
  }
  if (code.startsWith("INVALID_") || code === "SQL_INVALID" || code === "NAME_REQUIRED") {
    return EXIT_CODES.VALIDATION;
  }
  return EXIT_CODES.GENERIC;
}

const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

export interface EmitOptions {
  data: unknown;
  next_commands?: string[];
}

export function withNextCommands(
  data: Record<string, unknown>,
  next_commands?: string[],
): Record<string, unknown> {
  if (!next_commands?.length) {
    return data;
  }
  return {
    ...data,
    next_commands: next_commands.map((command) => ({ command })),
  };
}

export function emit(options: EmitOptions): void {
  const base =
    options.data !== null && typeof options.data === "object" && !Array.isArray(options.data)
      ? (options.data as Record<string, unknown>)
      : { result: options.data };

  const payload = withNextCommands(base, options.next_commands);

  if (isJsonMode()) {
    console.log(JSON.stringify({ success: true, data: payload }, jsonReplacer, 2));
    return;
  }

  console.log(encode(payload));
}
