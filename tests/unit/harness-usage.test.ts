import { describe, expect, test } from "bun:test";
import {
  extractHarnessUsage,
  extractHarnessUsageExtraction,
  scopeJsonlLines,
  scopeTextByMarker,
  sumOpencodeUsageFromObject,
  sumOpenclawUsageFromScopedText,
  sumPiUsageFromLines,
} from "~/daemon/harness-usage.js";

const MARKER = "zenon.red{action:42}";

describe("scopeTextByMarker", () => {
  test("scopes until next action marker", () => {
    const text = `before\n${MARKER}\nusage here\nzenon.red{action:99}\nafter`;
    expect(scopeTextByMarker(text, MARKER)).toBe(`${MARKER}\nusage here\n`);
  });
});

describe("scopeJsonlLines", () => {
  test("includes marker line and stops at next marker", () => {
    const lines = [
      '{"other":1}',
      `{"text":"${MARKER}"}`,
      '{"message":{"usage":{"input":10,"output":5}}}',
      '{"text":"zenon.red{action:99}"}',
      '{"message":{"usage":{"input":999,"output":999}}}',
    ];
    const scoped = scopeJsonlLines(lines, MARKER);
    expect(scoped).toHaveLength(2);
    expect(sumPiUsageFromLines(scoped)).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe("sumPiUsageFromLines", () => {
  test("sums assistant usage fields", () => {
    const lines = [
      JSON.stringify({ message: { role: "assistant", usage: { input: 100, output: 20 } } }),
      JSON.stringify({ message: { role: "assistant", usage: { input: 50, output: 10 } } }),
    ];
    expect(sumPiUsageFromLines(lines)).toEqual({ inputTokens: 150, outputTokens: 30 });
  });

  test("skips non-assistant usage rows", () => {
    const lines = [
      JSON.stringify({ message: { role: "user", usage: { input: 999, output: 999 } } }),
      JSON.stringify({ message: { role: "assistant", usage: { input: 10, output: 2 } } }),
    ];
    expect(sumPiUsageFromLines(lines)).toEqual({ inputTokens: 10, outputTokens: 2 });
  });
});

describe("sumOpencodeUsageFromObject", () => {
  test("reads step-finish tokens", () => {
    expect(
      sumOpencodeUsageFromObject({
        type: "step-finish",
        tokens: { input: 1200, output: 340 },
      }),
    ).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  test("ignores non step-finish", () => {
    expect(sumOpencodeUsageFromObject({ type: "text", tokens: { input: 1, output: 1 } })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

describe("sumOpenclawUsageFromScopedText", () => {
  test("sums usage blocks in scoped text", () => {
    const scoped = `${MARKER}\n{"usage":{"input":400,"output":90}}\n{"usage":{"input":100,"output":10}}`;
    expect(sumOpenclawUsageFromScopedText(scoped)).toEqual({
      inputTokens: 500,
      outputTokens: 100,
    });
  });
});

describe("extractHarnessUsage", () => {
  test("custom harness returns zero", () => {
    expect(extractHarnessUsage("custom", 1, new Date())).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  test("custom harness has no debug reason", () => {
    expect(extractHarnessUsageExtraction("custom", 1, new Date()).debugReason).toBeUndefined();
  });
});
