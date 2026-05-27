import { afterEach, describe, expect, it } from "bun:test";
import { EXIT_CODES, exitCodeFor } from "../../src/utils/emit.js";
import { ProbeError, isProbeError } from "../../src/utils/errors.js";
import { renderProbeError } from "../../src/utils/boundary.js";
import { error } from "../../src/utils/output.js";

const realConsoleError = globalThis.console.error.bind(console);

afterEach(() => {
  globalThis.console.error = realConsoleError;
});

describe("ProbeError", () => {
  it("derives exitCode from exitCodeFor when not overridden", () => {
    const err = ProbeError.of("WALLET_REQUIRED", "Wallet required");
    expect(err.code).toBe("WALLET_REQUIRED");
    expect(err.message).toBe("Wallet required");
    expect(err.exitCode).toBe(exitCodeFor("WALLET_REQUIRED"));
    expect(isProbeError(err)).toBe(true);
  });

  it("accepts an explicit exitCode override", () => {
    const err = ProbeError.of("CUSTOM", "Custom failure", undefined, 42);
    expect(err.exitCode).toBe(42);
  });

  it("carries an optional suggestion", () => {
    const err = ProbeError.of("TASK_NOT_FOUND", "Missing task", "probe task list");
    expect(err.suggestion).toBe("probe task list");
  });
});

describe("error()", () => {
  it("throws ProbeError with mapped exit code", () => {
    expect(() => error("PASSWORD_REQUIRED", "Password required", "Use --password-file")).toThrow(
      ProbeError,
    );

    try {
      error("PASSWORD_REQUIRED", "Password required", "Use --password-file");
    } catch (err) {
      expect(isProbeError(err)).toBe(true);
      if (!isProbeError(err)) return;
      expect(err.code).toBe("PASSWORD_REQUIRED");
      expect(err.exitCode).toBe(EXIT_CODES.AUTH);
      expect(err.suggestion).toBe("Use --password-file");
    }
  });
});

describe("renderProbeError", () => {
  it("writes CODE: message and hint to stderr in default mode", () => {
    const errors: string[] = [];
    globalThis.console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      renderProbeError(
        ProbeError.of("PASSWORD_REQUIRED", "Password required", "Use --password-file"),
      );
    } finally {
      globalThis.console.error = realConsoleError;
    }

    expect(errors.join("\n")).toContain("PASSWORD_REQUIRED: Password required");
    expect(errors.join("\n")).toContain("hint: Use --password-file");
  });
});
