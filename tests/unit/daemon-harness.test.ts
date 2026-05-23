import { EventEmitter } from "node:events";
import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import {
  buildHarnessSpawnArgs,
  runHarness,
  type SpawnRunner,
} from "../../src/daemon/harness-runner.js";

function mockChild(behavior: "exit0" | "exit1" | "signal" | "error" | "hang"): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as { kill: (signal?: string) => void }).kill = () => {
    if (behavior === "hang") {
      child.emit("close", null, "SIGKILL");
    }
  };

  queueMicrotask(() => {
    if (behavior === "exit0") child.emit("close", 0, null);
    if (behavior === "exit1") child.emit("close", 1, null);
    if (behavior === "signal") child.emit("close", null, "SIGTERM");
    if (behavior === "error") child.emit("error", new Error("spawn failed"));
  });

  return child;
}

function createSpawnMock(behavior: "exit0" | "exit1" | "signal" | "error" | "hang"): SpawnRunner {
  return () => mockChild(behavior);
}

const piHarness = { harness: "pi" as const, command: "pi", args: [] };

describe("buildHarnessSpawnArgs", () => {
  it("builds pi args", () => {
    expect(buildHarnessSpawnArgs(piHarness, "do work")).toEqual(["pi", "-p", "do work"]);
  });

  it("builds hermes args", () => {
    expect(buildHarnessSpawnArgs({ harness: "hermes", command: "hermes", args: [] }, "x")).toEqual([
      "hermes",
      "-z",
      "x",
    ]);
  });

  it("builds openclaw args", () => {
    expect(
      buildHarnessSpawnArgs({ harness: "openclaw", command: "openclaw", args: [] }, "x"),
    ).toEqual(["openclaw", "agent", "-m", "x", "--json"]);
  });

  it("builds custom args", () => {
    expect(
      buildHarnessSpawnArgs({ harness: "custom", command: "/bin/run", args: ["--flag"] }, "prompt"),
    ).toEqual(["/bin/run", "--flag", "prompt"]);
  });
});

describe("runHarness outcomes", () => {
  it("maps clean exit (code 0) to Clean", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 30,
      spawnFn: createSpawnMock("exit0"),
    });
    expect(result.outcome).toBe("Clean");
  });

  it("maps non-zero exit to Signal", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 30,
      spawnFn: createSpawnMock("exit1"),
    });
    expect(result.outcome).toBe("Signal");
  });

  it("maps process signal to Signal", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 30,
      spawnFn: createSpawnMock("signal"),
    });
    expect(result.outcome).toBe("Signal");
  });

  it("maps spawn error to SpawnFailed", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 30,
      spawnFn: createSpawnMock("error"),
    });
    expect(result.outcome).toBe("SpawnFailed");
  });

  it("maps timeout to Timeout", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 0.05,
      spawnFn: createSpawnMock("hang"),
    });
    expect(result.outcome).toBe("Timeout");
  }, 10_000);

  it("reports duration in seconds", async () => {
    const result = await runHarness({
      harness: piHarness,
      prompt: "test",
      timeoutSecs: 30,
      spawnFn: createSpawnMock("exit0"),
    });
    expect(result.durationSecs).toBeGreaterThanOrEqual(0);
  });
});
