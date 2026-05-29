import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import * as openspecCheck from "../../src/utils/openspec-check.js";
import { computeSyncStatus } from "../../src/utils/genesis-runtime.js";

afterEach(() => {
  mock.restore();
});

describe("computeSyncStatus openspec", () => {
  test("marks SyncFailed with openspec reason when pin mismatches", () => {
    spyOn(openspecCheck, "checkOpenspecCompatForGenesis").mockReturnValue({
      status: "warn",
      expected: "1.3.1",
      installed: "1.0.0",
      message: "OpenSpec version mismatch",
      fixCommand: "probe upgrade --yes",
    });

    const result = computeSyncStatus({
      localHash: "abc",
      applied: {
        genesisHash: "abc",
        skillsSource: "zenon-red/skills",
        skillsRef: "v0.3.7",
        githubOrg: "zenon-red",
      },
      localProbeVersion: "1.3.9",
      localOpenspecVersion: "1.3.1",
      localSkillsSource: "zenon-red/skills",
      localSkillsRef: "v0.3.7",
    });

    expect(result.status.tag).toBe("SyncFailed");
    expect(result.syncFailedReason).toBe("openspec");
  });
});
