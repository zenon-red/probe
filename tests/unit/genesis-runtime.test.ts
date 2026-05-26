import { describe, expect, test } from "bun:test";
import { compareSemver, computeSyncStatus } from "../../src/utils/genesis-runtime.js";

describe("genesis runtime", () => {
  test("compareSemver orders probe versions", () => {
    expect(compareSemver("1.2.7", "1.2.6")).toBe(1);
    expect(compareSemver("1.2.7", "1.2.7")).toBe(0);
    expect(compareSemver("1.2.6", "1.2.7")).toBe(-1);
  });

  test("computeSyncStatus reports genesis drift", () => {
    const { status } = computeSyncStatus({
      localHash: "abc",
      applied: {
        genesisHash: "def",
        skillsSource: "zenon-red/skills",
        skillsRef: "v0.0.0-dev",
        githubOrg: "zenon-red",
      },
      localProbeVersion: "1.2.7",
    });
    expect(status.tag).toBe("GenesisDrift");
  });
});
