import { describe, expect, it } from "bun:test";
import { skillsInstallArgs, skillsInstallCommand } from "../../src/utils/genesis-skills.js";

describe("skillsInstallCommand", () => {
  it("pins source and ref from genesis", () => {
    const cmd = skillsInstallCommand("acme/skills", "v1.0.0");
    expect(cmd).toBe("npx skills add acme/skills#v1.0.0 --skill='*' -y -g");
    expect(cmd).toContain("--skill='*'");
    expect(cmd).toContain("-y -g");
  });

  it("exposes argv for shell-free execution", () => {
    expect(skillsInstallArgs({ source: "acme/skills", ref: "v1.0.0" })).toEqual([
      "skills",
      "add",
      "acme/skills#v1.0.0",
      "--skill=*",
      "-y",
      "-g",
    ]);
  });

  it("rejects unsafe source and ref values", () => {
    expect(() => skillsInstallCommand("acme/skills;touch-pwn", "v1.0.0")).toThrow();
    expect(() => skillsInstallCommand("acme/skills", "v1.0.0;touch-pwn")).toThrow();
  });
});
