import { describe, expect, test } from "bun:test";
import {
  openspecInstallCommand,
  validateOpenspecVersion,
} from "../../src/utils/openspec-install.js";

describe("validateOpenspecVersion", () => {
  test("accepts exact semver", () => {
    expect(validateOpenspecVersion("1.3.1")).toBe("1.3.1");
  });

  test("rejects ranges", () => {
    expect(() => validateOpenspecVersion("^1.3.0")).toThrow(/exact semver/);
  });

  test("rejects partial versions", () => {
    expect(() => validateOpenspecVersion("1.3")).toThrow(/exact semver/);
  });
});

describe("openspecInstallCommand", () => {
  test("formats npm global install", () => {
    expect(openspecInstallCommand("1.3.1")).toBe("npm install -g @fission-ai/openspec@1.3.1");
  });
});
