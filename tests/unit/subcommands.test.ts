import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as contextModule from "../../src/utils/context.js";
import auth from "../../src/commands/auth/index.js";
import config from "../../src/commands/config/index.js";
import message from "../../src/commands/nexus/message.js";
import {
  guardNexusDaemonArgv,
  guardUnknownSubcommand,
  resolveKnownSubcommand,
  scanArgvCommandTokens,
} from "../../src/utils/subcommand.js";
import task from "../../src/commands/nexus/task.js";
import agent from "../../src/commands/nexus/agent.js";
import project from "../../src/commands/nexus/project.js";
import { messageListCommand } from "../../src/commands/nexus/message/list.js";
import { taskListCommand } from "../../src/commands/nexus/task/list.js";
import configGet from "../../src/commands/config/get.js";
import authStatus from "../../src/commands/auth/status.js";
import agentList from "../../src/commands/nexus/agent/list.js";
import projectList from "../../src/commands/nexus/project/list.js";
import * as configShared from "../../src/commands/config/shared.js";
import * as tokenCache from "../../src/utils/token-cache.js";

describe("subcommand-only parent commands", () => {
  it("message exposes citty subcommands", () => {
    expect(Object.keys(message.subCommands ?? {}).sort()).toEqual([
      "channels",
      "directive",
      "directives",
      "list",
      "send",
    ]);
  });

  it("task exposes citty subcommands", () => {
    expect(Object.keys(task.subCommands ?? {}).sort()).toEqual([
      "claim",
      "create",
      "deps",
      "get",
      "list",
      "ready",
      "review",
      "update",
      "watch",
    ]);
  });

  it("agent exposes citty subcommands", () => {
    expect(Object.keys(agent.subCommands ?? {}).sort()).toEqual([
      "bio",
      "capabilities",
      "heartbeat",
      "identity",
      "list",
      "me",
      "register",
      "set-status",
      "status",
      "voice",
    ]);
  });

  it("project exposes citty subcommands", () => {
    expect(Object.keys(project.subCommands ?? {}).sort()).toEqual([
      "create",
      "get",
      "list",
      "set-status",
      "spec",
      "status",
    ]);
  });

  it("config exposes citty subcommands", () => {
    expect(Object.keys(config.subCommands ?? {}).sort()).toEqual(["get", "list", "set"]);
  });

  it("auth exposes only status subcommand", () => {
    expect(Object.keys(auth.subCommands ?? {}).sort()).toEqual(["status"]);
  });

  it("rejects removed auth login subcommand", () => {
    try {
      guardUnknownSubcommand(["auth", "login"]);
      throw new Error("expected UNKNOWN_SUBCOMMAND");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("UNKNOWN_SUBCOMMAND");
    }
  });

  it("message parent requires a subcommand", () => {
    const prevArgv = process.argv;
    process.argv = ["bun", "probe", "message"];
    try {
      message.run?.({ args: { _: ["message"] } } as never);
      throw new Error("expected SUBCOMMAND_REQUIRED");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("SUBCOMMAND_REQUIRED");
    } finally {
      process.argv = prevArgv;
    }
  });

  it("task parent rejects unknown subcommand with ProbeError", () => {
    try {
      guardUnknownSubcommand(["task", "bogus"]);
      throw new Error("expected UNKNOWN_SUBCOMMAND");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("UNKNOWN_SUBCOMMAND");
    }
  });

  it("resolveKnownSubcommand skips option values before the real subcommand", () => {
    const known = new Set(["show", "complete"]);
    expect(resolveKnownSubcommand("action", known, ["action", "alice", "show", "42"])).toBe("show");
    expect(resolveKnownSubcommand("action", known, ["action", "show", "42"])).toBe("show");
  });

  it("guardUnknownSubcommand allows parent options before subcommand", () => {
    expect(() =>
      guardUnknownSubcommand(["action", "--wallet", "alice", "show", "42"]),
    ).not.toThrow();
    expect(() => guardUnknownSubcommand(["action", "--json", "show", "42"])).not.toThrow();
  });

  it("scanArgvCommandTokens skips value-flag arguments but not boolean flags", () => {
    expect(scanArgvCommandTokens(["action", "--wallet", "alice", "show", "42"])).toEqual([
      "action",
      "show",
      "42",
    ]);
    expect(scanArgvCommandTokens(["action", "--json", "show", "42"])).toEqual([
      "action",
      "show",
      "42",
    ]);
  });

  it("guardNexusDaemonArgv rejects mistaken subcommands after nexus", () => {
    try {
      guardNexusDaemonArgv(["nexus", "agent", "identity", "--wallet", "zr-zoe"]);
      throw new Error("expected UNKNOWN_ARGS");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("UNKNOWN_ARGS");
      expect((err as { message?: string }).message).toContain("agent identity");
      expect((err as { suggestion?: string }).suggestion).toBe(
        "Did you mean: probe agent identity?",
      );
    }
  });

  it("guardNexusDaemonArgv allows bare nexus with flags only", () => {
    expect(() =>
      guardNexusDaemonArgv(["nexus", "--wallet", "zr-zoe", "--harness", "opencode"]),
    ).not.toThrow();
  });

  it("guardUnknownSubcommand reports bogus not option value as unknown subcommand", () => {
    try {
      guardUnknownSubcommand(["action", "--wallet", "alice", "bogus"]);
      throw new Error("expected UNKNOWN_SUBCOMMAND");
    } catch (err) {
      expect((err as { code?: string; message?: string }).code).toBe("UNKNOWN_SUBCOMMAND");
      expect((err as { message?: string }).message).toContain("bogus");
      expect((err as { message?: string }).message).not.toContain("alice");
    }
  });
});

describe("representative subcommand dispatch", () => {
  const capturedCreateOptions: Record<string, unknown>[] = [];

  afterEach(() => {
    capturedCreateOptions.length = 0;
    mock.restore();
  });

  const mockReadContext = (tableData: Record<string, unknown[]>) => {
    spyOn(contextModule.CommandContext, "create").mockImplementation(async (options) => {
      capturedCreateOptions.push(options as Record<string, unknown>);
      return {
        ...tableData,
        [Symbol.asyncDispose]: async () => {},
      } as unknown as contextModule.CommandContext;
    });
  };

  it("message list subcommand forwards host/module and lists messages", async () => {
    mockReadContext({
      messages: [],
      channels: [{ id: 1n, name: "general" }],
      projects: [],
      projectChannels: [],
      projectMessages: [],
    });

    await messageListCommand.run?.({
      args: {
        _: [],
        host: "ws://msg-host:3000",
        module: "msg-module",
        json: false,
        limit: "5",
      },
    } as never);

    expect(capturedCreateOptions[0]).toMatchObject({
      host: "ws://msg-host:3000",
      module: "msg-module",
    });
  });

  it("task list subcommand forwards host/module", async () => {
    mockReadContext({ tasks: [] });

    await taskListCommand.run?.({
      args: {
        _: [],
        host: "ws://task-host:3000",
        module: "task-module",
        json: false,
      },
    } as never);

    expect(capturedCreateOptions[0]).toMatchObject({
      host: "ws://task-host:3000",
      module: "task-module",
    });
  });

  it("agent list subcommand forwards host/module", async () => {
    mockReadContext({ agents: [] });

    await agentList.run?.({
      args: {
        _: [],
        host: "ws://agent-host:3000",
        module: "agent-module",
        json: false,
      },
    } as never);

    expect(capturedCreateOptions[0]).toMatchObject({
      host: "ws://agent-host:3000",
      module: "agent-module",
    });
  });

  it("project list subcommand forwards host/module", async () => {
    mockReadContext({ projects: [] });

    await projectList.run?.({
      args: {
        _: [],
        host: "ws://project-host:3000",
        module: "project-module",
        json: false,
      },
    } as never);

    expect(capturedCreateOptions[0]).toMatchObject({
      host: "ws://project-host:3000",
      module: "project-module",
    });
  });

  it("config get subcommand reads a config key", async () => {
    spyOn(configShared, "readConfigValue").mockResolvedValue("wss://maincloud.spacetimedb.com");

    await configGet.run?.({
      args: {
        _: [],
        key: "spacetime.host",
        json: false,
      },
    } as never);

    expect(configShared.readConfigValue).toHaveBeenCalledWith("spacetime.host");
  });

  it("auth status subcommand reports missing cached token", async () => {
    spyOn(tokenCache, "getCachedToken").mockResolvedValue(null);

    await authStatus.run?.({
      args: {
        _: [],
        wallet: "test-wallet",
        json: false,
      },
    } as never);

    expect(tokenCache.getCachedToken).toHaveBeenCalledWith("test-wallet");
  });
});
