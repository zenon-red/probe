import { describe, expect, it } from "bun:test";
import { runSkillsRefCheck } from "../../src/utils/skills-ref-release.js";

describe("runSkillsRefCheck", () => {
  it("exits 0 when latest tag matches expected", () => {
    const result = runSkillsRefCheck({
      expectedRef: "v0.3.3",
      latestTag: "v0.3.3",
      strict: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("skills-ref ok");
  });

  it("exits 0 on mismatch in warn mode", () => {
    const result = runSkillsRefCheck({
      expectedRef: "v0.3.3",
      latestTag: "v0.3.4",
      strict: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("v0.3.4");
  });

  it("exits 1 on mismatch in strict mode", () => {
    const result = runSkillsRefCheck({
      expectedRef: "v0.3.3",
      latestTag: "v0.3.4",
      strict: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("bump EXPECTED_SKILLS_REF");
  });

  it("exits 0 in warn mode when latest tag cannot be determined", () => {
    const result = runSkillsRefCheck({
      expectedRef: "v0.3.3",
      latestTag: null,
      strict: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("Could not determine");
  });

  it("exits 1 in strict mode when latest tag cannot be determined", () => {
    const result = runSkillsRefCheck({
      expectedRef: "v0.3.3",
      latestTag: null,
      strict: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("Could not determine");
  });
});
