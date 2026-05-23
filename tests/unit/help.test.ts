import { afterEach, describe, expect, it } from "bun:test";
import { printConciseRootHelp, printHelp } from "../../src/utils/help.js";

describe("help output", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
  });

  const captureHelp = (fn: () => void): string => {
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    fn();
    return logs.join("\n");
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
});
