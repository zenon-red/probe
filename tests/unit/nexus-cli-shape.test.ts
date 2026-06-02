import { describe, expect, it } from "bun:test";
import nexus from "../../src/commands/nexus/index.js";
import { guardNexusDaemonArgv } from "../../src/utils/subcommand.js";

describe("nexus CLI shape", () => {
  it("exposes run, status, and tui subcommands", () => {
    expect(Object.keys(nexus.subCommands ?? {}).sort()).toContain("run");
    expect(Object.keys(nexus.subCommands ?? {}).sort()).toContain("status");
    expect(Object.keys(nexus.subCommands ?? {}).sort()).toContain("tui");
  });

  it("guardNexusDaemonArgv allows status, run, and tui", () => {
    expect(() => guardNexusDaemonArgv(["nexus", "status", "--wallet", "w"])).not.toThrow();
    expect(() => guardNexusDaemonArgv(["nexus", "run", "--wallet", "w"])).not.toThrow();
    expect(() => guardNexusDaemonArgv(["nexus", "tui", "--wallet", "w"])).not.toThrow();
    expect(() => guardNexusDaemonArgv(["nexus", "--wallet", "w"])).not.toThrow();
  });

  it("guardNexusDaemonArgv rejects probe nexus task", () => {
    try {
      guardNexusDaemonArgv(["nexus", "task", "list"]);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("UNKNOWN_ARGS");
    }
  });
});
