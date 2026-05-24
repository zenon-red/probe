import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { SkillsCompat } from "../../src/utils/skills-check.js";
import { SKILLS_INSTALL_CMD } from "../../src/utils/skills-check.js";
import { emitUpgradeFinish } from "../../src/utils/upgrade-skills-output.js";
import { setJsonMode } from "../../src/utils/output-mode.js";

const fixtures = join(import.meta.dir, "../fixtures/skills-lock");
const realConsoleLog = globalThis.console.log.bind(console);
const realConsoleError = globalThis.console.error.bind(console);

const upgradeBase = {
  method: "npm",
  currentVersion: "1.0.0",
  targetVersion: "1.1.0",
  latestVersion: "1.1.0",
  updateAvailable: true,
  updated: true,
  checkOnly: false,
};

const warnCompat: SkillsCompat = {
  status: "warn",
  expectedRef: "v0.3.3",
  foundRef: "v0.3.2",
  message: "Skills ref mismatch: expected v0.3.3, found v0.3.2",
  fixCommand: SKILLS_INSTALL_CMD,
};

function captureConsole() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  globalThis.console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  globalThis.console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  return { stdout, stderr };
}

afterEach(() => {
  globalThis.console.log = realConsoleLog;
  globalThis.console.error = realConsoleError;
  setJsonMode(false);
});

describe("emitUpgradeFinish", () => {
  it("omits skillsCompat when upgrade did not run", () => {
    setJsonMode(true);
    const { stdout, stderr } = captureConsole();
    emitUpgradeFinish({ ...upgradeBase, updated: false, checkOnly: true }, false, {
      checkSkillsCompat: () => {
        throw new Error("should not check skills on --check");
      },
    });

    const parsed = JSON.parse(stdout.join("\n").trim());
    expect(parsed.data.updated).toBe(false);
    expect(parsed.data.skillsCompat).toBeUndefined();
    expect(stderr.join("\n")).not.toContain("Skills");
  });

  it("includes skillsCompat on stdout in JSON mode without stderr compat prose", () => {
    setJsonMode(true);
    const { stdout, stderr } = captureConsole();
    emitUpgradeFinish(upgradeBase, true, {
      lockPath: join(fixtures, "ok.json"),
    });

    const parsed = JSON.parse(stdout.join("\n").trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.skillsCompat?.status).toBe("ok");
    expect(stderr.join("\n")).not.toMatch(/⚠|Skills ref mismatch/);
  });

  it("prints compat hints to stderr only in human mode", () => {
    setJsonMode(false);
    const { stdout, stderr } = captureConsole();
    emitUpgradeFinish(upgradeBase, true, {
      checkSkillsCompat: () => warnCompat,
    });

    const stdoutText = stdout.join("\n");
    expect(stdoutText).not.toContain("⚠");
    expect(stdoutText).not.toContain(SKILLS_INSTALL_CMD);

    const stderrText = stderr.join("\n");
    expect(stderrText).toContain("⚠");
    expect(stderrText).toContain(SKILLS_INSTALL_CMD);
  });

  it("uses injected lock path instead of global lock file", () => {
    setJsonMode(true);
    const { stdout } = captureConsole();
    emitUpgradeFinish(upgradeBase, true, {
      lockPath: join(fixtures, "warn-mismatch.json"),
    });

    const parsed = JSON.parse(stdout.join("\n").trim());
    expect(parsed.data.skillsCompat?.status).toBe("warn");
    expect(parsed.data.skillsCompat?.foundRef).toBe("v0.3.2");
  });
});
