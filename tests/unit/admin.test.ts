import { describe, expect, it } from "bun:test";
import admin from "../../src/commands/admin/index.js";
import { parseTargetIdentityHex } from "../../src/commands/admin/shared.js";
import { ProbeError } from "../../src/utils/errors.js";

describe("probe admin", () => {
  it("exposes assign-human subcommand", () => {
    expect(Object.keys(admin.subCommands ?? {}).sort()).toEqual(["assign-human"]);
  });

  it("parseTargetIdentityHex accepts 64-char hex", () => {
    const hex = "c2002e6ad15a78dc71dac52b50d410b95970e024d4869a05d5950f2b0f72e0ca";
    expect(parseTargetIdentityHex(hex).toHexString()).toBe(hex);
  });

  it("parseTargetIdentityHex rejects invalid identity", () => {
    expect(() => parseTargetIdentityHex("not-a-hex")).toThrow(ProbeError);
  });
});
