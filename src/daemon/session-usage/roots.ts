import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessType } from "~/types/config.js";

export function defaultSessionRoot(harness: HarnessType): string | undefined {
  const home = homedir();
  switch (harness) {
    case "pi": {
      const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
      if (explicit) {
        return join(explicit, "sessions");
      }
      return join(home, ".pi", "agent", "sessions");
    }
    case "hermes":
      return join(home, ".hermes");
    case "opencode": {
      const data = process.env.OPENCODE_DATA_DIR?.trim();
      if (data) {
        return join(data, "storage");
      }
      return join(home, ".local", "share", "opencode", "storage");
    }
    case "openclaw":
      return join(home, ".openclaw", "sessions");
    default:
      return undefined;
  }
}

export function resolveSessionRoot(
  harness: HarnessType,
  overrides?: Partial<Record<HarnessType, string>>,
): string | undefined {
  const override = overrides?.[harness]?.trim();
  if (override) {
    return override;
  }
  return defaultSessionRoot(harness);
}
