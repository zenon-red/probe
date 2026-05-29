import { describe, expect, test } from "bun:test";
import { buildDoctorNextCommands, type DoctorIssue } from "../../src/utils/doctor-issues.js";

describe("buildDoctorNextCommands", () => {
  test("dedupes repeated fix commands", () => {
    const issues: DoctorIssue[] = [
      {
        code: "PROBE_VERSION_BELOW_MIN",
        severity: "fail",
        message: "probe old",
        fix_command: "probe upgrade --yes",
      },
      {
        code: "OPENSPEC_NOT_FOUND",
        severity: "warn",
        message: "openspec missing",
        fix_command: "probe upgrade --yes",
      },
    ];

    const commands = buildDoctorNextCommands(issues, undefined);
    expect(commands?.filter((c) => c === "probe upgrade --yes")).toHaveLength(1);
  });
});
