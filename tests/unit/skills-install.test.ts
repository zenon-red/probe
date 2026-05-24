import { describe, expect, it } from "bun:test";
import { EXPECTED_SKILLS_REF, SKILLS_INSTALL_CMD } from "../../src/utils/skills-check.js";

describe("skills install command", () => {
  it("pins zenon-red/skills to EXPECTED_SKILLS_REF", () => {
    expect(SKILLS_INSTALL_CMD).toContain(`zenon-red/skills#${EXPECTED_SKILLS_REF}`);
    expect(SKILLS_INSTALL_CMD).toContain("--skill='*'");
    expect(SKILLS_INSTALL_CMD).toContain("-y -g");
  });
});
