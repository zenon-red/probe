import { describe, expect, it } from "bun:test";
import human from "../../src/commands/human/index.js";
import { parseDispatchMode, parseTargetIdentityHex } from "../../src/commands/human/shared.js";
import { readDispatchEnabled } from "../../src/utils/dispatch-enabled.js";
import { ProbeError } from "../../src/utils/errors.js";

describe("probe human", () => {
  it("exposes assign, dispatch, and review subcommands", () => {
    expect(Object.keys(human.subCommands ?? {}).sort()).toEqual(["assign", "dispatch", "review"]);
  });

  it("review exposes idea and spec", () => {
    const subCommands = human.subCommands as Record<
      string,
      { subCommands?: Record<string, unknown> }
    >;
    const review = subCommands.review;
    expect(Object.keys(review.subCommands ?? {}).sort()).toEqual(["idea", "spec"]);
  });

  it("parseTargetIdentityHex accepts 64-char hex", () => {
    const hex = "c2002e6ad15a78dc71dac52b50d410b95970e024d4869a05d5950f2b0f72e0ca";
    expect(parseTargetIdentityHex(hex).toHexString()).toBe(hex);
  });

  it("parseTargetIdentityHex rejects invalid identity", () => {
    expect(() => parseTargetIdentityHex("not-a-hex")).toThrow(ProbeError);
  });

  it("parseDispatchMode accepts on, off, status", () => {
    expect(parseDispatchMode("on")).toBe("on");
    expect(parseDispatchMode("OFF")).toBe("off");
    expect(parseDispatchMode(" status ")).toBe("status");
  });

  it("readDispatchEnabled treats missing and false", () => {
    expect(readDispatchEnabled([])).toBe(true);
    expect(readDispatchEnabled([{ key: "dispatch_enabled", value: "false" }])).toBe(false);
    expect(readDispatchEnabled([{ key: "dispatch_enabled", value: "true" }])).toBe(true);
  });
});
