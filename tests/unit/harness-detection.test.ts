import { afterEach, describe, expect, test } from "bun:test";
import {
  formatAmbiguousHarnessMessage,
  formatHarnessOperatorQuestion,
  resolveOnboardHarness,
  type HarnessDetectionDeps,
} from "~/utils/harness-detection.js";

const pi = { harness: "pi" as const, command: "pi", args: ["-p"] };
const hermes = { harness: "hermes" as const, command: "hermes", args: ["-z"] };

function deps(overrides: Partial<HarnessDetectionDeps> = {}): HarnessDetectionDeps {
  return {
    commandExists: () => false,
    existsSync: () => false,
    ...overrides,
  };
}

describe("resolveOnboardHarness", () => {
  afterEach(() => {
    delete process.env.PROBE_HARNESS;
    delete process.env.HARNESS;
  });

  test("resolves explicit harness when detected", () => {
    expect(resolveOnboardHarness("pi", deps({ commandExists: (cmd) => cmd === "pi" }))).toEqual({
      kind: "resolved",
      harness: pi,
    });
  });

  test("returns none when nothing detected", () => {
    expect(resolveOnboardHarness("auto", deps())).toEqual({ kind: "none" });
  });

  test("auto resolves single harness", () => {
    expect(
      resolveOnboardHarness("auto", deps({ commandExists: (cmd) => cmd === "hermes" })),
    ).toEqual({ kind: "resolved", harness: hermes });
  });

  test("returns ambiguous when multiple detected and no env", () => {
    const result = resolveOnboardHarness(
      "auto",
      deps({ commandExists: (cmd) => cmd === "pi" || cmd === "hermes" }),
    );
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.detected.map((d) => d.harness).sort()).toEqual(["hermes", "pi"]);
    }
  });

  test("uses PROBE_HARNESS when multiple detected", () => {
    process.env.PROBE_HARNESS = "hermes";
    expect(
      resolveOnboardHarness(
        "auto",
        deps({ commandExists: (cmd) => cmd === "pi" || cmd === "hermes" }),
      ),
    ).toEqual({ kind: "resolved", harness: hermes });
  });

  test("uses HARNESS env when PROBE_HARNESS unset", () => {
    process.env.HARNESS = "pi";
    expect(
      resolveOnboardHarness(
        "auto",
        deps({ commandExists: (cmd) => cmd === "pi" || cmd === "hermes" }),
      ),
    ).toEqual({ kind: "resolved", harness: pi });
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
