import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  checkSkillsCompatForGenesis,
  skillsInstallCommand,
} from "../../src/utils/genesis-skills.js";
import {
  compareSkillsReleaseRef,
  pickLatestVTag,
  printSkillsCompatToStderr,
} from "../../src/utils/skills-check.js";

const fixtures = join(import.meta.dir, "../fixtures/skills-lock");
const SOURCE = "zenon-red/skills";
const REF = "v0.3.4";
const INSTALL_CMD = skillsInstallCommand(SOURCE, REF);

describe("checkSkillsCompatForGenesis", () => {
  it("returns ok when all rows for source match genesis ref", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "ok.json"),
    });
    expect(result.status).toBe("ok");
    expect(result.expectedRef).toBe(REF);
    expect(result.foundRef).toBe(REF);
  });

  it("returns warn on ref mismatch", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "warn-mismatch.json"),
    });
    expect(result.status).toBe("warn");
    expect(result.foundRef).toBe("v0.3.2");
    expect(result.fixCommand).toBe(INSTALL_CMD);
  });

  it("returns warn when ref is missing", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "warn-missing-ref.json"),
    });
    expect(result.status).toBe("warn");
  });

  it("returns warn when refs disagree across rows", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "warn-mixed-refs.json"),
    });
    expect(result.status).toBe("warn");
  });

  it("returns unknown when no entries for source", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "empty-skills.json"),
    });
    expect(result.status).toBe("unknown");
  });

  it("returns unknown for missing lock file", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "does-not-exist.json"),
    });
    expect(result.status).toBe("unknown");
  });

  it("returns unknown for invalid json", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "invalid-lock.txt"),
    });
    expect(result.status).toBe("unknown");
  });

  it("does not throw on malformed lock entries", () => {
    const result = checkSkillsCompatForGenesis(SOURCE, REF, {
      lockPath: join(fixtures, "malformed-entries.json"),
    });
    expect(result.status).toBe("ok");
    expect(result.foundRef).toBe(REF);
  });
});

describe("compareSkillsReleaseRef", () => {
  it("matches when latest tag equals expected", () => {
    const result = compareSkillsReleaseRef(SOURCE, "v0.3.3", "v0.3.3");
    expect(result.status).toBe("match");
  });

  it("reports mismatch when latest tag is newer", () => {
    const result = compareSkillsReleaseRef(SOURCE, "v0.3.3", "v0.3.4");
    expect(result.status).toBe("mismatch");
    expect(result.message).toContain("v0.3.4");
  });

  it("reports unknown when latest tag cannot be determined", () => {
    const result = compareSkillsReleaseRef(SOURCE, "v0.3.3", null);
    expect(result.status).toBe("unknown");
  });
});

describe("printSkillsCompatToStderr", () => {
  it("prints fix command on warn", () => {
    let stderrText = "";
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      stderrText += `${args.join(" ")}\n`;
    };
    try {
      printSkillsCompatToStderr({
        status: "warn",
        expectedSource: SOURCE,
        expectedRef: REF,
        message: "mismatch",
        fixCommand: INSTALL_CMD,
      });
      expect(stderrText).toContain(INSTALL_CMD);
    } finally {
      console.error = origError;
    }
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
