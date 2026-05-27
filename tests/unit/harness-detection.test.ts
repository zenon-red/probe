import { afterEach, describe, expect, mock, test } from "bun:test";

const commandExists = mock((cmd: string) => false);
const existsSync = mock(() => false);

mock.module("~/utils/system.js", () => ({ commandExists }));
mock.module("node:fs", () => ({ existsSync }));

const { formatAmbiguousHarnessMessage, formatHarnessOperatorQuestion, resolveOnboardHarness } =
  await import("~/utils/harness-detection.js");

const pi = { harness: "pi" as const, command: "pi", args: ["-p"] };
const hermes = { harness: "hermes" as const, command: "hermes", args: ["-z"] };

describe("resolveOnboardHarness", () => {
  afterEach(() => {
    commandExists.mockReset();
    existsSync.mockReset();
    delete process.env.PROBE_HARNESS;
    delete process.env.HARNESS;
  });

  test("resolves explicit harness when detected", () => {
    commandExists.mockImplementation((cmd: string) => cmd === "pi");
    expect(resolveOnboardHarness("pi")).toEqual({ kind: "resolved", harness: pi });
  });

  test("returns none when nothing detected", () => {
    expect(resolveOnboardHarness("auto")).toEqual({ kind: "none" });
  });

  test("auto resolves single harness", () => {
    commandExists.mockImplementation((cmd: string) => cmd === "hermes");
    expect(resolveOnboardHarness("auto")).toEqual({ kind: "resolved", harness: hermes });
  });

  test("returns ambiguous when multiple detected and no env", () => {
    commandExists.mockImplementation((cmd: string) => cmd === "pi" || cmd === "hermes");
    const result = resolveOnboardHarness("auto");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.detected.map((d) => d.harness).sort()).toEqual(["hermes", "pi"]);
    }
  });

  test("uses PROBE_HARNESS when multiple detected", () => {
    commandExists.mockImplementation((cmd: string) => cmd === "pi" || cmd === "hermes");
    process.env.PROBE_HARNESS = "hermes";
    expect(resolveOnboardHarness("auto")).toEqual({ kind: "resolved", harness: hermes });
  });

  test("uses HARNESS env when PROBE_HARNESS unset", () => {
    commandExists.mockImplementation((cmd: string) => cmd === "pi" || cmd === "hermes");
    process.env.HARNESS = "pi";
    expect(resolveOnboardHarness("auto")).toEqual({ kind: "resolved", harness: pi });
  });
});

describe("formatHarnessOperatorQuestion", () => {
  test("uses operator question form for two harnesses", () => {
    const msg = formatHarnessOperatorQuestion([pi, hermes]);
    expect(msg).toContain("two possible harnesses");
    expect(msg).toContain("Which one would you like to use");
    expect(msg).toContain("- pi");
    expect(msg).toContain("- hermes");
  });
});

describe("formatAmbiguousHarnessMessage", () => {
  test("lists harness names and rerun hint", () => {
    const msg = formatAmbiguousHarnessMessage([pi, hermes]);
    expect(msg).toContain("pi, hermes");
    expect(msg).toContain("--harness");
    expect(msg).toContain("two possible harnesses");
  });
});
