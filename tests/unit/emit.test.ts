import { afterEach, describe, expect, it } from "bun:test";
import { renderProbeError } from "../../src/utils/boundary.js";
import { emit, exitCodeFor, EXIT_CODES } from "../../src/utils/emit.js";
import { ProbeError } from "../../src/utils/errors.js";
import { setJsonMode } from "../../src/utils/output-mode.js";

const realConsoleLog = globalThis.console.log.bind(console);
const realConsoleError = globalThis.console.error.bind(console);

afterEach(() => {
  globalThis.console.log = realConsoleLog;
  globalThis.console.error = realConsoleError;
  setJsonMode(false);
});

describe("emit", () => {
  it("writes TOON to stdout in default mode", () => {
    const logs: string[] = [];
    globalThis.console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      emit({ data: { tasks: [{ id: 1, title: "Test" }], count: 1 } });
    } finally {
      globalThis.console.log = realConsoleLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("tasks");
    expect(output).toContain("Test");
  });

  it("writes JSON envelope with --json mode", () => {
    setJsonMode(true);
    const logs: string[] = [];
    globalThis.console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      emit({ data: { ok: true }, next_commands: ["probe doctor"] });
    } finally {
      globalThis.console.log = realConsoleLog;
    }

    const parsed = JSON.parse(logs.join("\n").trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.ok).toBe(true);
    expect(parsed.data.next_commands).toEqual([{ command: "probe doctor" }]);
  });
});

describe("exitCodeFor", () => {
  it("maps auth errors to exit code 2", () => {
    expect(exitCodeFor("PASSWORD_REQUIRED")).toBe(EXIT_CODES.AUTH);
    expect(exitCodeFor("AUTH_REQUIRED")).toBe(EXIT_CODES.AUTH);
  });

  it("maps connection errors to exit code 3", () => {
    expect(exitCodeFor("CONNECTION_ERROR")).toBe(EXIT_CODES.CONNECTION);
  });

  it("maps not found errors to exit code 5", () => {
    expect(exitCodeFor("WALLET_NOT_FOUND")).toBe(EXIT_CODES.NOT_FOUND);
    expect(exitCodeFor("TASK_NOT_FOUND")).toBe(EXIT_CODES.NOT_FOUND);
  });

  it("maps validation errors to exit code 4", () => {
    expect(exitCodeFor("INVALID_OUTCOME")).toBe(EXIT_CODES.VALIDATION);
  });
});

describe("error output format", () => {
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

  it("writes JSON envelope to stderr in json mode", () => {
    setJsonMode(true);
    const errors: string[] = [];
    globalThis.console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      renderProbeError(ProbeError.of("TASK_NOT_FOUND", "Task missing", "probe task list --json"));
    } finally {
      globalThis.console.error = realConsoleError;
    }

    const parsed = JSON.parse(errors.join("\n").trim());
    expect(parsed.success).toBe(false);
    expect(parsed.error).toEqual({
      code: "TASK_NOT_FOUND",
      message: "Task missing",
      suggestion: "probe task list --json",
    });
  });
});
