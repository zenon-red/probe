import { error } from "./output.js";

export function parseActionId(value: unknown): bigint {
  try {
    const id = BigInt(String(value));
    if (id < 0n) {
      error("INVALID_ACTION_ID", `Invalid action ID: ${value}`);
    }
    return id;
  } catch {
    error("INVALID_ACTION_ID", `Invalid action ID: ${value}`);
  }
}
