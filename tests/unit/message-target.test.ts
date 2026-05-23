import { describe, expect, it } from "bun:test";
import type { Channel, Project } from "../../src/utils/context.js";
import { resolveMessageTarget } from "../../src/commands/nexus/message-target.js";
import { isProbeError } from "../../src/utils/errors.js";

const projects = [{ id: 42n, name: "alpha" }] as Project[];

const channels = [{ id: 7n, name: "general" }] as Channel[];

function expectProbeError(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(isProbeError(err)).toBe(true);
    if (!isProbeError(err)) throw err;
    expect(err.code).toBe(code);
  }
}

describe("resolveMessageTarget", () => {
  it("resolves numeric-only input to a project", () => {
    const target = resolveMessageTarget("42", projects, channels);
    expect(target).toEqual({
      kind: "project",
      projectId: 42n,
      projectName: "alpha",
    });
  });

  it("resolves non-numeric input to a channel by name", () => {
    const target = resolveMessageTarget("general", projects, channels);
    expect(target).toEqual({
      kind: "channel",
      channelId: 7n,
      channelName: "general",
    });
  });

  it("resolves channel: prefix for numeric channel id", () => {
    const target = resolveMessageTarget("channel:7", projects, channels);
    expect(target).toEqual({
      kind: "channel",
      channelId: 7n,
      channelName: "general",
    });
  });

  it("resolves project: prefix explicitly", () => {
    const target = resolveMessageTarget("project:42", projects, channels);
    expect(target).toEqual({
      kind: "project",
      projectId: 42n,
      projectName: "alpha",
    });
  });

  it("fails when numeric input matches a channel but not a project", () => {
    expectProbeError(() => resolveMessageTarget("7", projects, channels), "PROJECT_NOT_FOUND");
    try {
      resolveMessageTarget("7", projects, channels);
    } catch (err) {
      if (!isProbeError(err)) throw err;
      expect(err.message).toContain("7");
      expect(err.suggestion).toContain("channel:7");
    }
  });

  it("fails when project is missing", () => {
    expectProbeError(() => resolveMessageTarget("99", projects, channels), "PROJECT_NOT_FOUND");
    try {
      resolveMessageTarget("99", projects, channels);
    } catch (err) {
      if (!isProbeError(err)) throw err;
      expect(err.message).toContain("99");
      expect(err.suggestion).toBeUndefined();
    }
  });

  it("fails when channel is missing", () => {
    expectProbeError(
      () => resolveMessageTarget("missing", projects, channels),
      "CHANNEL_NOT_FOUND",
    );
    try {
      resolveMessageTarget("missing", projects, channels);
    } catch (err) {
      if (!isProbeError(err)) throw err;
      expect(err.message).toContain("missing");
    }
  });
});
