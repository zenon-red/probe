import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { createActionExecutor, type IssuedAction } from "../../src/daemon/action-executor.js";
import { runDaemonSession } from "../../src/daemon/session.js";
import type { SpawnRunner } from "../../src/daemon/harness-runner.js";

function mockChildExit(code: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  queueMicrotask(() => child.emit("close", code, null));
  return child;
}

function createSpawnMock(exitCode: number): SpawnRunner {
  return () => mockChildExit(exitCode);
}

const baseAction: IssuedAction = {
  id: 42,
  agentId: "agent-1",
  kind: { tag: "Run" },
  status: { tag: "Issued" },
  skill: "test",
  instruction: "do it",
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
    config: { harnessTimeoutSecs: 30, requestTimeout: 100 },
    conn: {
      reducers: { reportActionRunStarted, reportActionRunFinished },
    },
  };
}

describe("createActionExecutor", () => {
  const events: Record<string, unknown>[] = [];
  let runningHarness: ChildProcess | null = null;
  let runningActionId: number | null = null;

  afterEach(() => {
    events.length = 0;
    runningHarness = null;
    runningActionId = null;
  });

  function makeExecutor(spawnFn: SpawnRunner, reducerBehavior: "ok" | "fail" = "ok") {
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
      spawnFn,
    });
  }

  it("emits action_completed on clean harness exit", async () => {
    await makeExecutor(createSpawnMock(0))(baseAction);
    expect(events.some((e) => e.type === "action_started")).toBe(true);
    expect(events.some((e) => e.type === "action_completed" && e.outcome === "Clean")).toBe(true);
    expect(runningActionId).toBeNull();
    expect(runningHarness).toBeNull();
  });

  it("emits action_failed_infra on non-zero exit", async () => {
    await makeExecutor(createSpawnMock(1))(baseAction);
    expect(events.some((e) => e.type === "action_failed_infra" && e.outcome === "Signal")).toBe(
      true,
    );
  });

  it("continues when run-started reducer fails", async () => {
    await makeExecutor(createSpawnMock(0), "fail")(baseAction);
    expect(events.some((e) => e.type === "action_completed")).toBe(true);
  });

  it("continues when run-finished reducer fails", async () => {
    await makeExecutor(createSpawnMock(0), "fail")(baseAction);
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

  function createSessionCtx() {
    return {
      identity: { toHexString: () => "abc" },
      agents: [{ id: "agent-1" }],
      config: { harnessTimeoutSecs: 0.05, requestTimeout: 100 },
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

  it("emits harness_spawn_violation when action arrives during running harness", async () => {
    let resolveClose!: () => void;
    let stop = false;
    const hangSpawn: SpawnRunner = () => {
      const child = new EventEmitter() as ChildProcess;
      resolveClose = () => child.emit("close", 0, null);
      return child;
    };

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
      spawnFn: hangSpawn,
    });

    while (!insertHandler) {
      await new Promise((r) => setTimeout(r, 5));
    }

    insertHandler?.(null, { ...baseAction, id: 1, status: { tag: "Issued" } });
    while (!events.some((e) => e.type === "action_started")) {
      await new Promise((r) => setTimeout(r, 5));
    }

    insertHandler?.(null, { ...baseAction, id: 2, status: { tag: "Issued" } });

    expect(events.some((e) => e.type === "action_received" && e.action_id === 2)).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "harness_spawn_violation" && e.action_id === 2 && e.running_action_id === 1,
      ),
    ).toBe(true);

    stop = true;
    resolveClose();
    await sessionPromise;
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
      spawnFn: createSpawnMock(0),
    });

    while (!insertHandler) {
      await new Promise((r) => setTimeout(r, 5));
    }

    insertHandler?.(null, { ...baseAction, status: { tag: "Completed" } });
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
      spawnFn: createSpawnMock(0),
    });

    await new Promise((r) => setTimeout(r, 50));
    stopAfterHeartbeat = true;
    await sessionPromise;

    expect(jitterValues.length).toBeGreaterThan(0);
    expect(heartbeatCalls).toBeGreaterThan(0);
  });
});
