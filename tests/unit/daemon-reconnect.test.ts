import { afterEach, describe, expect, it, mock } from "bun:test";
import { backoffMs, runDaemonLoop, withJitter } from "../../src/daemon/loop.js";
import { HEARTBEAT, RECONNECT } from "../../src/utils/timeouts.js";
import { connectErrorLooksAuthRelated } from "../../src/daemon/session.js";

describe("backoffMs and withJitter", () => {
  it("computes exponential backoff capped at RECONNECT.MAX_MS", () => {
    const fixedRandom = () => 0.5;
    const attempt1 = backoffMs(1, fixedRandom);
    const attempt10 = backoffMs(10, fixedRandom);

    expect(attempt1).toBeGreaterThanOrEqual(1_000);
    expect(attempt10).toBeLessThanOrEqual(RECONNECT.MAX_MS + HEARTBEAT.JITTER_MS);
  });

  it("applies jitter within expected bounds", () => {
    const base = 10_000;
    const low = withJitter(base, () => 0);
    const high = withJitter(base, () => 1);

    expect(low).toBe(base - HEARTBEAT.JITTER_MS);
    expect(high).toBe(base + HEARTBEAT.JITTER_MS + 1);
  });

  it("never returns less than 1000ms", () => {
    expect(withJitter(100, () => 0)).toBe(1_000);
  });
});

describe("connectErrorLooksAuthRelated", () => {
  it("detects auth-related connection errors", () => {
    expect(connectErrorLooksAuthRelated("Authentication required")).toBe(true);
    expect(connectErrorLooksAuthRelated("HTTP 401 Unauthorized")).toBe(true);
    expect(connectErrorLooksAuthRelated("connection reset")).toBe(false);
  });
});

describe("runDaemonLoop reconnect", () => {
  const lines: string[] = [];

  const mockConfig = {
    harnessCommand: "/bin/echo",
    harnessArgs: [],
    spacetime: { host: "ws://127.0.0.1:3000", module: "nexus-dev" },
  };

  function subscriptionBuilderMock() {
    const builder = {
      onApplied: (cb: () => void) => {
        builder._onApplied = cb;
        return builder;
      },
      onError: () => builder,
      subscribe: () => {
        builder._onApplied?.();
      },
      _onApplied: undefined as (() => void) | undefined,
    };
    return builder;
  }

  afterEach(() => {
    lines.length = 0;
  });

  it("emits disconnected, reconnecting, and reconnected on session drop", async () => {
    let authSessions = 0;
    let daemonSessions = 0;

    const withAuthMock = mock(
      async (_options: unknown, handler: (ctx: unknown) => Promise<unknown>) => {
        authSessions += 1;
        return await handler({
          identity: { toHexString: () => "deadbeef" },
          auth: { wallet: "w" },
          agents: [{ id: "agent-1" }],
          config: { harnessTimeoutSecs: 30 },
          conn: {
            subscriptionBuilder: subscriptionBuilderMock,
            reducers: { heartbeat: mock(async () => {}) },
          },
          db: { agent_actions: { onInsert: () => {} } },
        });
      },
    );

    const runDaemonSessionFn = mock(async () => {
      daemonSessions += 1;
      if (daemonSessions === 1) {
        return { reason: "disconnected", details: { message: "connection lost" } };
      }
      process.emit("SIGINT");
      return null;
    });

    const originalLog = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };

    try {
      await runDaemonLoop({
        args: { wallet: "w", "log-level": "critical", harness: "custom" },
        withAuthFn: withAuthMock as never,
        getConfigFn: async () => mockConfig as never,
        resolveLogStreamFn: async () => null,
        runDaemonSessionFn: runDaemonSessionFn as never,
        sleepFn: async () => {},
        backoffMsFn: () => 1,
      });
    } finally {
      console.log = originalLog;
    }

    const types = lines.map((line) => JSON.parse(line).type);
    expect(types).toContain("connected");
    expect(types).toContain("disconnected");
    expect(types).toContain("reconnecting");
    expect(types).toContain("reconnected");
    expect(types).toContain("shutdown");
    expect(authSessions).toBeGreaterThanOrEqual(2);
  });

  it("stops reconnect loop on auth failure", async () => {
    const withAuthMock = mock(async () => {
      throw new Error("HTTP 401 Unauthorized");
    });

    const originalLog = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };

    try {
      await runDaemonLoop({
        args: { wallet: "w", "log-level": "critical", harness: "custom" },
        withAuthFn: withAuthMock as never,
        getConfigFn: async () => mockConfig as never,
        resolveLogStreamFn: async () => null,
        sleepFn: async () => {},
      });
    } finally {
      console.log = originalLog;
    }

    const types = lines.map((line) => JSON.parse(line).type);
    expect(types).toContain("auth_failed");
    expect(types).not.toContain("reconnecting");
    expect(withAuthMock).toHaveBeenCalledTimes(1);
  });
});
