import { describe, expect, it } from "bun:test";
import {
  buildDoctorNextCommands,
  countIssues,
  doctorOk,
  type DoctorIssue,
} from "../../src/utils/doctor-issues.js";

describe("doctor issues", () => {
  it("ok is false when any fail-severity issue exists", () => {
    const issues: DoctorIssue[] = [
      { code: "AUTH_TOKEN_MISSING", severity: "fail", message: "missing" },
      { code: "HOST_EXECUTION_UNTRUSTED", severity: "warn", message: "sandbox" },
    ];
    expect(doctorOk(issues)).toBe(false);
    expect(countIssues(issues)).toEqual({ fail: 1, warn: 1 });
  });

  it("ok is true when only warnings exist", () => {
    const issues: DoctorIssue[] = [
      { code: "NEXUS_CONNECTION_SKIPPED", severity: "warn", message: "skipped" },
    ];
    expect(doctorOk(issues)).toBe(true);
  });

  it("builds next_commands from issue codes", () => {
    const issues: DoctorIssue[] = [
      {
        code: "AUTH_TOKEN_EXPIRED",
        severity: "fail",
        message: "expired",
        fix_command: "probe token my-wallet --clear",
      },
    ];
    const commands = buildDoctorNextCommands(issues, "my-wallet");
    expect(commands).toContain("probe token my-wallet --clear");
    expect(commands).toContain("probe auth my-wallet --password-file <path> --save");
  });

  it("includes registration command for AGENT_NOT_REGISTERED", () => {
    const issues: DoctorIssue[] = [
      { code: "AGENT_NOT_REGISTERED", severity: "fail", message: "not registered" },
    ];
    const commands = buildDoctorNextCommands(issues, "my-wallet");
    expect(commands?.some((cmd) => cmd.includes("agent register"))).toBe(true);
  });
});
