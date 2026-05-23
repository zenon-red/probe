import { afterEach, describe, expect, it } from "bun:test";
import { emit, exitCodeFor, EXIT_CODES } from "../../src/utils/emit.js";
import { setJsonMode } from "../../src/utils/output-mode.js";

describe("emit", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
    setJsonMode(false);
  });

  it("writes TOON to stdout in default mode", () => {
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    emit({ data: { tasks: [{ id: 1, title: "Test" }], count: 1 } });

    const output = logs.join("\n");
    expect(output).toContain("tasks");
    expect(output).toContain("Test");
  });

  it("writes JSON envelope with --json mode", () => {
    setJsonMode(true);
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    emit({ data: { ok: true }, next_commands: ["probe doctor"] });

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
  it("writes CODE: message and hint to stderr in default mode", async () => {
    const { error } = await import("../../src/utils/output.js");
    const errors: string[] = [];
    let exitCode = 0;

    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("exit");
    }) as typeof process.exit;

    expect(() => error("PASSWORD_REQUIRED", "Password required", "Use --password-file")).toThrow(
      "exit",
    );
    expect(errors.join("\n")).toContain("PASSWORD_REQUIRED: Password required");
    expect(errors.join("\n")).toContain("hint: Use --password-file");
    expect(exitCode).toBe(EXIT_CODES.AUTH);
  });
});
