import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ChildProcess } from "node:child_process";
import type { RunAcpSessionOptions } from "../../src/acp/run-action.js";
import { emptyTelemetry } from "../../src/acp/telemetry.js";
import type { AgentRunOutcome } from "../../src/acp/types.js";
import { createActionExecutor, type ExecutableAction } from "../../src/daemon/action-executor.js";
import { runDaemonSession } from "../../src/daemon/session.js";

function createAcpSessionMock(outcome: AgentRunOutcome) {
  return mock(async (options: RunAcpSessionOptions) => {
    const child = new EventEmitter() as ChildProcess;
    options.onChild?.(child);
    queueMicrotask(() => child.emit("close", outcome === "Clean" ? 0 : 1, null));
    return {
      outcome,
      durationSecs: 1,
      telemetry: emptyTelemetry(),
      completionReported: true,
      nexusMcpAttached: false,
    };
  });
}

const baseAction: ExecutableAction = {
  id: 42n,
  agentId: "agent-1",
  kind: { tag: "ExecuteTask" },
  skills: ["test"],
  instruction: "do it",
  route: { tag: "ContinueOwnedTask" },
  targetType: undefined,
  targetId: undefined,
  triggerType: "dispatch_run",
};

/** Match production loop sleep — a no-op sleep causes a tight spin in runDaemonSession. */
const sessionSleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

function createMockCtx(reducerBehavior: "ok" | "fail" = "ok") {
  const reportActionRunStarted = mock(async () => {
    if (reducerBehavior === "fail") throw new Error("run started failed");
  });
  const reportActionRunFinished = mock(async () => {
    if (reducerBehavior === "fail") throw new Error("run finished failed");
  });

  return {
    config: {
      harnessTimeoutSecs: 30,
      requestTimeout: 100,
      spacetime: { host: "wss://test.example", module: "nexus-test" },
    },
    agents: [],
    auth: { wallet: "test-wallet", token: "test-token", identity: null },
    conn: {
      reducers: { reportActionRunStarted, reportActionRunFinished },
    },
  };
}

describe("createActionExecutor", () => {
  const events: Record<string, unknown>[] = [];
  let runningHarness: ChildProcess | null = null;
  let runningActionId: bigint | null = null;

  afterEach(() => {
    events.length = 0;
    runningHarness = null;
    runningActionId = null;
  });

  function makeExecutor(outcome: AgentRunOutcome, reducerBehavior: "ok" | "fail" = "ok") {
    return createActionExecutor({
      ctx: createMockCtx(reducerBehavior) as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      setRunningHarness: (child) => {
        runningHarness = child;
      },
      setRunningActionId: (id) => {
        runningActionId = id;
      },
      runAcpSession: createAcpSessionMock(outcome),
    });
  }

  it("emits action_completed on clean harness exit", async () => {
    await makeExecutor("Clean")(baseAction);
    expect(events.some((e) => e.type === "action_started")).toBe(true);
    expect(events.some((e) => e.type === "action_completed" && e.outcome === "Clean")).toBe(true);
    expect(runningActionId).toBeNull();
    expect(runningHarness).toBeNull();
  });

  it("emits action_failed_infra on non-zero exit", async () => {
    await makeExecutor("Signal")(baseAction);
    expect(events.some((e) => e.type === "action_failed_infra" && e.outcome === "Signal")).toBe(
      true,
    );
  });

  it("continues when run-started reducer fails", async () => {
    await makeExecutor("Clean", "fail")(baseAction);
    expect(events.some((e) => e.type === "action_completed")).toBe(true);
  });

  it("continues when run-finished reducer fails", async () => {
    await makeExecutor("Clean", "fail")(baseAction);
    expect(events.some((e) => e.type === "action_completed")).toBe(true);
  });
});

describe("runDaemonSession invariants", () => {
  const events: Record<string, unknown>[] = [];
  let insertHandler: ((_ctx: unknown, row: unknown) => void) | undefined;
  let heartbeatCalls = 0;

  afterEach(() => {
    events.length = 0;
    insertHandler = undefined;
    heartbeatCalls = 0;
  });

  function createSessionCtx(harnessTimeoutSecs = 0.05) {
    return {
      identity: { toHexString: () => "abc" },
      agents: [{ id: "agent-1" }],
      config: {
        harnessTimeoutSecs,
        requestTimeout: 100,
        spacetime: { host: "wss://test.example", module: "nexus-test" },
      },
      auth: { wallet: "test-wallet", token: "test-token", identity: null },
      conn: {
        subscriptionBuilder: () => {
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
        },
        reducers: {
          heartbeat: mock(async () => {
            heartbeatCalls += 1;
          }),
          reportActionRunStarted: mock(async () => {}),
          reportActionRunFinished: mock(async () => {}),
        },
      },
      db: {
        agent_actions: {
          onInsert: (cb: (_ctx: unknown, row: unknown) => void) => {
            insertHandler = cb;
          },
        },
      },
    };
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for condition");
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  function createHangAcpSession(): {
    runAcpSession: ReturnType<typeof createAcpSessionMock>;
    releaseFirst: () => void;
  } {
    let releaseFirst!: () => void;
    let sessionCount = 0;
    const runAcpSession = mock(async (options: RunAcpSessionOptions) => {
      sessionCount += 1;
      const child = new EventEmitter() as ChildProcess;
      (child as { kill: (signal?: string) => void }).kill = () => {};
      options.onChild?.(child);
      if (sessionCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return {
        outcome: "Clean" as const,
        durationSecs: 1,
        telemetry: emptyTelemetry(),
        completionReported: true,
        nexusMcpAttached: false,
      };
    });
    return { runAcpSession, releaseFirst: () => releaseFirst() };
  }

  it("queues and drains action when insert arrives during running harness", async () => {
    let stop = false;
    const { runAcpSession: hangAcpSession, releaseFirst } = createHangAcpSession();

    const sessionPromise = runDaemonSession({
      ctx: createSessionCtx(300) as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      effectiveWallet: "w",
      resolvedHost: "host",
      resolvedModule: "mod",
      logFile: null,
      logLevel: "critical",
      stopping: () => stop,
      stopWaiter: new Promise(() => {}),
      sleep: sessionSleep,
      withJitter: () => 50,
      runAcpSession: hangAcpSession,
    });

    await waitFor(() => insertHandler !== undefined);

    insertHandler?.(null, {
      ...baseAction,
      id: 1n,
      status: { tag: "Issued" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await waitFor(() => events.some((e) => e.type === "action_started" && e.action_id === "1"));

    insertHandler?.(null, {
      ...baseAction,
      id: 2n,
      status: { tag: "Issued" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(events.some((e) => e.type === "action_received" && e.action_id === "2")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "action_queued" && e.action_id === "2" && e.running_action_id === "1",
      ),
    ).toBe(true);

    releaseFirst();
    await waitFor(() => events.some((e) => e.type === "action_started" && e.action_id === "2"));
    await waitFor(() => events.some((e) => e.type === "action_completed" && e.action_id === "2"));

    stop = true;
    await sessionPromise;
  });

  it("drains multiple queued actions in order", async () => {
    let stop = false;
    const { runAcpSession: hangAcpSession, releaseFirst } = createHangAcpSession();

    const sessionPromise = runDaemonSession({
      ctx: createSessionCtx(300) as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      effectiveWallet: "w",
      resolvedHost: "host",
      resolvedModule: "mod",
      logFile: null,
      logLevel: "critical",
      stopping: () => stop,
      stopWaiter: new Promise(() => {}),
      sleep: sessionSleep,
      withJitter: () => 50,
      runAcpSession: hangAcpSession,
    });

    await waitFor(() => insertHandler !== undefined);

    insertHandler?.(null, {
      ...baseAction,
      id: 1n,
      status: { tag: "Issued" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await waitFor(() => events.some((e) => e.type === "action_started" && e.action_id === "1"));

    for (const id of [2n, 3n]) {
      insertHandler?.(null, {
        ...baseAction,
        id,
        status: { tag: "Issued" },
        reasonCode: "test",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }

    expect(events.filter((e) => e.type === "action_queued").map((e) => e.action_id)).toEqual([
      "2",
      "3",
    ]);

    releaseFirst();
    await waitFor(() => events.some((e) => e.type === "action_completed" && e.action_id === "2"));
    await waitFor(() => events.some((e) => e.type === "action_completed" && e.action_id === "3"));

    const completedIds = events
      .filter((e) => e.type === "action_completed")
      .map((e) => e.action_id);
    expect(completedIds.indexOf("2")).toBeLessThan(completedIds.indexOf("3"));

    stop = true;
    await sessionPromise;
  });

  it("abandons queued actions on shutdown", async () => {
    let stop = false;
    const { runAcpSession: hangAcpSession } = createHangAcpSession();

    const sessionPromise = runDaemonSession({
      ctx: createSessionCtx(300) as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      effectiveWallet: "w",
      resolvedHost: "host",
      resolvedModule: "mod",
      logFile: null,
      logLevel: "critical",
      stopping: () => stop,
      stopWaiter: new Promise(() => {}),
      sleep: sessionSleep,
      withJitter: () => 50,
      runAcpSession: hangAcpSession,
    });

    await waitFor(() => insertHandler !== undefined);

    insertHandler?.(null, {
      ...baseAction,
      id: 1n,
      status: { tag: "Issued" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await waitFor(() => events.some((e) => e.type === "action_started" && e.action_id === "1"));

    insertHandler?.(null, {
      ...baseAction,
      id: 2n,
      status: { tag: "Issued" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await waitFor(() => events.some((e) => e.type === "action_queued" && e.action_id === "2"));

    stop = true;
    await sessionPromise;

    expect(
      events.some(
        (e) =>
          e.type === "action_queue_abandoned" &&
          e.reason === "shutdown" &&
          (e.action_ids as string[]).includes("2"),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "action_started" && e.action_id === "2")).toBe(false);
  });

  it("ignores non-Issued action inserts", async () => {
    let stop = false;
    const sessionPromise = runDaemonSession({
      ctx: createSessionCtx() as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      effectiveWallet: "w",
      resolvedHost: "host",
      resolvedModule: "mod",
      logFile: null,
      logLevel: "critical",
      stopping: () => stop,
      stopWaiter: new Promise(() => {}),
      sleep: sessionSleep,
      withJitter: () => 50,
      runAcpSession: createAcpSessionMock("Clean"),
    });

    await waitFor(() => insertHandler !== undefined);

    insertHandler?.(null, {
      ...baseAction,
      status: { tag: "Completed" },
      reasonCode: "test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    stop = true;
    await sessionPromise;

    expect(events.some((e) => e.type === "action_received")).toBe(false);
  });

  it("schedules heartbeat with jitter", async () => {
    const jitterValues: number[] = [];
    let stopAfterHeartbeat = false;

    const sessionPromise = runDaemonSession({
      ctx: createSessionCtx() as never,
      harness: { harness: "pi", command: "pi", args: [] },
      emit: (event) => events.push(event),
      effectiveWallet: "w",
      resolvedHost: "host",
      resolvedModule: "mod",
      logFile: null,
      logLevel: "critical",
      stopping: () => stopAfterHeartbeat,
      stopWaiter: new Promise(() => {}),
      sleep: sessionSleep,
      withJitter: (base) => {
        jitterValues.push(base);
        return 20;
      },
      runAcpSession: createAcpSessionMock("Clean"),
    });

    await new Promise((r) => setTimeout(r, 50));
    stopAfterHeartbeat = true;
    await sessionPromise;

    expect(jitterValues.length).toBeGreaterThan(0);
    expect(heartbeatCalls).toBeGreaterThan(0);
  });
});
