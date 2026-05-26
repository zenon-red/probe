import { describe, expect, it } from "bun:test";
import { runSkillsRefCheck } from "../../src/utils/skills-ref-release.js";

describe("runSkillsRefCheck", () => {
  it("exits 0 on match", () => {
    const result = runSkillsRefCheck({
      skillsSource: "acme/skills",
      expectedRef: "v1.0.0",
      latestTag: "v1.0.0",
    });
    expect(result.exitCode).toBe(0);
  });

  it("warns on mismatch in non-strict mode", () => {
    const result = runSkillsRefCheck({
      skillsSource: "acme/skills",
      expectedRef: "v1.0.0",
      latestTag: "v1.1.0",
      strict: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("genesis pins");
  });

  it("fails on mismatch in strict mode", () => {
    const result = runSkillsRefCheck({
      skillsSource: "acme/skills",
      expectedRef: "v1.0.0",
      latestTag: "v1.1.0",
      strict: true,
    });
    expect(result.exitCode).toBe(1);
  });
});
