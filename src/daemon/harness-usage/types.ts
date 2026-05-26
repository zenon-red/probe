export type HarnessUsage = { inputTokens: number; outputTokens: number };

export type HarnessUsageExtraction = {
  usage: HarnessUsage;
  debugReason?: string;
};

export const EMPTY_USAGE: HarnessUsage = { inputTokens: 0, outputTokens: 0 };
