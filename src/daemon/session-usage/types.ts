import type { HarnessType } from "~/types/config.js";

export type SessionUsageResult = {
  found: boolean;
  inputTokens: number;
  outputTokens: number;
  sessionFile?: string;
  reason?: string;
};

export type SessionUsageContext = {
  harness: HarnessType;
  runStartedAt: Date;
  marker: string;
  markerPrefix: string;
  dataRoots?: Partial<Record<HarnessType, string>>;
};

export const SESSION_SHIM_HARNESSES = new Set<HarnessType>([
  "pi",
  "hermes",
  "opencode",
  "openclaw",
]);
