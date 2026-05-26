import { afterEach, describe, expect, it } from "bun:test";
import { skillsInstallCommand, type SkillsCompat } from "../../src/utils/genesis-skills.js";
import { applyJsonMode, setJsonMode } from "../../src/utils/output-mode.js";
import { emitUpgradeFinish } from "../../src/utils/upgrade-skills-output.js";

const SOURCE = "acme/skills";
const REF = "v1.0.0";
const INSTALL_CMD = skillsInstallCommand(SOURCE, REF);
const realConsoleLog = console.log.bind(console);
const realConsoleError = console.error.bind(console);

const base = {
  method: "npm",
  currentVersion: "1.0.0",
  targetVersion: "1.1.0",
  latestVersion: "1.1.0",
  updateAvailable: true,
  updated: true,
  checkOnly: false,
};

const okCompat: SkillsCompat = {
  status: "ok",
  expectedSource: SOURCE,
  expectedRef: REF,
  foundRef: REF,
  message: "ok",
  fixCommand: INSTALL_CMD,
};

const warnCompat: SkillsCompat = {
  status: "warn",
  expectedSource: SOURCE,
  expectedRef: REF,
  foundRef: "v0.9.0",
  message: "Skills ref mismatch: expected v1.0.0, found v0.9.0",
  fixCommand: INSTALL_CMD,
};

function captureConsole(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  return { stdout, stderr };
}

afterEach(() => {
  console.log = realConsoleLog;
  console.error = realConsoleError;
  setJsonMode(false);
});

describe("emitUpgradeFinish skills compat", () => {
  it("does not load or check skills when upgrade did not run", async () => {
    applyJsonMode({ json: true });
    const { stdout } = captureConsole();
    await emitUpgradeFinish({ ...base, updated: false, checkOnly: true }, false, {
      loadSkillsSpec: async () => {
        throw new Error("should not load skills");
      },
      checkSkillsCompat: () => {
        throw new Error("should not check skills");
      },
    });

    const payload = JSON.parse(stdout.join("\n")) as { data: { skillsCompat?: unknown } };
    expect(payload.data.skillsCompat).toBeUndefined();
  });

  it("includes skillsCompat in JSON when updated", async () => {
    applyJsonMode({ json: true });
    const { stdout, stderr } = captureConsole();
    await emitUpgradeFinish(base, true, {
      loadSkillsSpec: async () => ({ source: SOURCE, ref: REF }),
      checkSkillsCompat: () => okCompat,
    });

    const payload = JSON.parse(stdout.join("\n")) as {
      data: { skillsCompat: { status: string } };
    };
    expect(payload.data.skillsCompat.status).toBe("ok");
    expect(stderr.join("\n")).toBe("");
  });

  it("prints warn compat only to stderr in human mode", async () => {
    const { stdout, stderr } = captureConsole();
    await emitUpgradeFinish(base, true, {
      loadSkillsSpec: async () => ({ source: SOURCE, ref: REF }),
      checkSkillsCompat: () => warnCompat,
    });

    expect(stdout.join("\n")).not.toContain(INSTALL_CMD);
    expect(stderr.join("\n")).toContain("⚠");
    expect(stderr.join("\n")).toContain(INSTALL_CMD);
  });

  it("reports unknown compat when genesis skills are not configured", async () => {
    applyJsonMode({ json: true });
    const { stdout } = captureConsole();
    await emitUpgradeFinish(base, true, {
      loadSkillsSpec: async () => null,
    });

    const payload = JSON.parse(stdout.join("\n")) as {
      data: { skillsCompat: { status: string; message: string } };
    };
    expect(payload.data.skillsCompat.status).toBe("unknown");
    expect(payload.data.skillsCompat.message).toContain("No genesis skills configured");
  });
});
