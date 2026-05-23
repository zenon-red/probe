import { afterEach, describe, expect, it } from "bun:test";
import task from "../../src/commands/nexus/task.js";
import { printConciseRootHelp, printHelp, setForceHelpRequested } from "../../src/utils/help.js";

const realConsoleLog = globalThis.console.log.bind(console);

describe("help output", () => {
  afterEach(() => {
    setForceHelpRequested(false);
  });

  const captureHelp = (fn: () => void): string => {
    const logs: string[] = [];
    globalThis.console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      fn();
      return logs.join("\n");
    } finally {
      globalThis.console.log = realConsoleLog;
    }
  };

  it("prints concise root help without ANSI escapes", () => {
    const output = captureHelp(() => printConciseRootHelp("Test CLI"));
    expect(output).toContain("USAGE");
    expect(output).toContain("probe task list");
    expect(output).not.toMatch(/\x1b/);
  });

  it("prints full help without ANSI escapes", () => {
    const output = captureHelp(() =>
      printHelp({
        command: "probe doctor",
        description: "Diagnostics",
        usage: ["probe doctor"],
        options: [{ name: "--fix", detail: "Apply safe fixes" }],
      }),
    );
    expect(output).toContain("OPTIONS");
    expect(output).toContain("--fix");
    expect(output).not.toMatch(/\x1b/);
    expect(output).not.toContain("docs/");
    expect(output).not.toContain("Documentation:");
  });

  it("prints task parent help without ANSI or positional action", () => {
    setForceHelpRequested(true);
    const output = captureHelp(() => {
      void task.run?.({ args: { _: [] } } as never);
    });
    expect(output).toContain("probe task");
    expect(output).toContain("list");
    expect(output).not.toMatch(/\x1b/);
    expect(output).not.toContain("<action>");
  });
});
