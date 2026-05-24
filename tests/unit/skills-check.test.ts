import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  EXPECTED_SKILLS_REF,
  SKILLS_INSTALL_CMD,
  checkSkillsCompat,
  compareSkillsReleaseRef,
  pickLatestVTag,
} from "../../src/utils/skills-check.js";

const fixtures = join(import.meta.dir, "../fixtures/skills-lock");

describe("checkSkillsCompat", () => {
  it("returns ok when all zenon-red rows match expected ref", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "ok.json") });
    expect(result.status).toBe("ok");
    expect(result.expectedRef).toBe(EXPECTED_SKILLS_REF);
    expect(result.foundRef).toBe(EXPECTED_SKILLS_REF);
  });

  it("returns warn on ref mismatch", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "warn-mismatch.json") });
    expect(result.status).toBe("warn");
    expect(result.foundRef).toBe("v0.3.2");
    expect(result.fixCommand).toBe(SKILLS_INSTALL_CMD);
  });

  it("returns warn when ref is missing", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "warn-missing-ref.json") });
    expect(result.status).toBe("warn");
  });

  it("returns warn when refs disagree across rows", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "warn-mixed-refs.json") });
    expect(result.status).toBe("warn");
  });

  it("returns unknown when no zenon-red entries", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "empty-skills.json") });
    expect(result.status).toBe("unknown");
  });

  it("returns unknown for missing lock file", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "does-not-exist.json") });
    expect(result.status).toBe("unknown");
  });

  it("returns unknown for invalid json", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "invalid-lock.txt") });
    expect(result.status).toBe("unknown");
  });

  it("does not throw on malformed lock entries", () => {
    const result = checkSkillsCompat({ lockPath: join(fixtures, "malformed-entries.json") });
    expect(result.status).toBe("ok");
    expect(result.foundRef).toBe(EXPECTED_SKILLS_REF);
  });
});

describe("compareSkillsReleaseRef", () => {
  it("matches when latest tag equals expected", () => {
    const result = compareSkillsReleaseRef("v0.3.3", "v0.3.3");
    expect(result.status).toBe("match");
  });

  it("reports mismatch when latest tag is newer", () => {
    const result = compareSkillsReleaseRef("v0.3.3", "v0.3.4");
    expect(result.status).toBe("mismatch");
    expect(result.message).toContain("v0.3.4");
  });

  it("reports unknown when latest tag cannot be determined", () => {
    const result = compareSkillsReleaseRef("v0.3.3", null);
    expect(result.status).toBe("unknown");
  });
});

describe("pickLatestVTag", () => {
  it("picks highest semver v tag", () => {
    expect(pickLatestVTag(["v0.3.2", "v0.3.10", "v0.3.3", "v0.2.0"])).toBe("v0.3.10");
  });

  it("returns null when no v tags", () => {
    expect(pickLatestVTag(["main", "release"])).toBeNull();
  });
});
