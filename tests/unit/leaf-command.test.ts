import { afterEach, describe, expect, it } from "bun:test";
import type { CommandDef } from "citty";
import ideaPropose from "../../src/commands/nexus/idea/propose.js";
import { setForceHelpRequested, setHelpJsonRequested } from "../../src/utils/help.js";
import { wrapLeafCommand } from "../../src/utils/leaf-command.js";

const realConsoleLog = globalThis.console.log.bind(console);

const proposeCommand = (): CommandDef =>
  wrapLeafCommand(ideaPropose as CommandDef, "probe idea propose");

describe("leaf command help", () => {
  afterEach(() => {
    setForceHelpRequested(false);
    setHelpJsonRequested(false);
  });

  const captureLog = async (fn: () => void | Promise<void>): Promise<string> => {
    const logs: string[] = [];
    globalThis.console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await fn();
      return logs.join("\n");
    } finally {
      globalThis.console.log = realConsoleLog;
    }
  };

  it("shows full help for probe idea propose --help", async () => {
    setForceHelpRequested(true);
    const output = await captureLog(async () => {
      await proposeCommand().run?.({
        args: { _: ["propose"], json: false },
      } as never);
    });
    expect(output).toContain("probe idea propose");
    expect(output).toContain("--action-id");
    expect(output).toContain("--title");
    expect(output).toContain("--description");
  });

  it("lists all missing required flags when args omitted", async () => {
    const output = await captureLog(async () => {
      await proposeCommand().run?.({
        args: { _: ["propose"], json: false },
      } as never);
    });
    expect(output).toContain("--title");
    expect(output).toContain("--description");
    expect(output).toContain("--action-id");
    expect(output).toContain("Missing required");
  });

  it("emits JSON help when --help --json", async () => {
    setForceHelpRequested(true);
    setHelpJsonRequested(true);
    const output = await captureLog(async () => {
      await proposeCommand().run?.({
        args: { _: ["propose"], json: true },
      } as never);
    });
    const parsed = JSON.parse(output) as { command: string; options: unknown[] };
    expect(parsed.command).toBe("probe idea propose");
    expect(parsed.options.length).toBeGreaterThan(0);
  });
});
