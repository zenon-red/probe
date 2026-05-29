import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { OpenspecCompat } from "../../src/utils/openspec-check.js";

let loadUserConfigImpl: () => Promise<Record<string, unknown>> = async () => ({});
let probeVersionImpl = () => "1.0.0";
let checkOpenspecImpl: () => OpenspecCompat = () => ({
  status: "ok",
  expected: "1.3.1",
  installed: "1.3.1",
  message: "ok",
  fixCommand: "probe upgrade --yes",
});
let checkSkillsImpl = () => ({
  status: "ok" as const,
  expectedSource: "acme/skills",
  expectedRef: "v1.0.0",
  foundRef: "v1.0.0",
  message: "ok",
  fixCommand: "npx skills add acme/skills#v1.0.0 --skill='*' -y -g",
});
let loadSkillsSpecImpl = async () => null as { source: string; ref: string } | null;
let installOpenspecImpl = async () => ({ installed: true, detail: "ok" });
let installSkillsImpl = async () => ({ installed: true, detail: "ok" });

mock.module("../../src/utils/user-config.js", () => ({
  loadUserConfig: () => loadUserConfigImpl(),
}));
mock.module("../../src/probe-version.js", () => ({
  probeVersion: () => probeVersionImpl(),
  probeDescription: "test",
}));
mock.module("../../src/utils/openspec-check.js", () => ({
  checkOpenspecCompatForGenesis: (..._args: unknown[]) => checkOpenspecImpl(),
}));
mock.module("../../src/utils/genesis-skills.js", () => ({
  checkSkillsCompatForGenesis: (..._args: unknown[]) => checkSkillsImpl(),
}));
mock.module("../../src/utils/genesis-skills-spec.js", () => ({
  loadSkillsSpecFromConfig: () => loadSkillsSpecImpl(),
}));
mock.module("../../src/utils/openspec-install.js", () => ({
  installOpenspec: (..._args: unknown[]) => installOpenspecImpl(),
}));
mock.module("../../src/utils/skills-install.js", () => ({
  installSkills: (..._args: unknown[]) => installSkillsImpl(),
}));

const { buildToolchainReport, syncToolchainFromGenesis } =
  await import("../../src/utils/upgrade-toolchain.js");

beforeEach(() => {
  loadUserConfigImpl = async () => ({});
  probeVersionImpl = () => "1.0.0";
  checkOpenspecImpl = () => ({
    status: "ok",
    expected: "1.3.1",
    installed: "1.3.1",
    message: "ok",
    fixCommand: "probe upgrade --yes",
  });
  checkSkillsImpl = () => ({
    status: "ok",
    expectedSource: "acme/skills",
    expectedRef: "v1.0.0",
    foundRef: "v1.0.0",
    message: "ok",
    fixCommand: "npx skills add acme/skills#v1.0.0 --skill='*' -y -g",
  });
  loadSkillsSpecImpl = async () => null;
  installOpenspecImpl = async () => ({ installed: true, detail: "ok" });
  installSkillsImpl = async () => ({ installed: true, detail: "ok" });
});

afterEach(() => {
  mock.restore();
});

describe("buildToolchainReport", () => {
  it("reports warn when probe is below minProbeVersion", async () => {
    loadUserConfigImpl = async () => ({ genesisHash: "abc", minProbeVersion: "2.0.0" });
    probeVersionImpl = () => "1.0.0";

    const report = await buildToolchainReport();
    expect(report.probe.status).toBe("warn");
    expect(report.probe.expected).toBe("2.0.0");
  });

  it("includes openspec when pinned", async () => {
    loadUserConfigImpl = async () => ({ genesisHash: "abc", openspecVersion: "1.3.1" });
    checkOpenspecImpl = () => ({
      status: "warn",
      expected: "1.3.1",
      message: "OpenSpec not installed",
      fixCommand: "probe upgrade --yes",
    });

    const report = await buildToolchainReport();
    expect(report.openspec?.status).toBe("warn");
  });
});

describe("syncToolchainFromGenesis", () => {
  it("warns when no genesis is configured", async () => {
    loadUserConfigImpl = async () => ({});

    const { warnings } = await syncToolchainFromGenesis(true);
    expect(warnings[0]).toContain("No local genesis configured");
  });

  it("installs openspec and skills when requested", async () => {
    let openspecCalled = false;
    let skillsCalled = false;
    loadUserConfigImpl = async () => ({
      genesisSource: "/genesis.json",
      openspecVersion: "1.3.1",
    });
    loadSkillsSpecImpl = async () => ({ source: "acme/skills", ref: "v1.0.0" });
    installOpenspecImpl = async () => {
      openspecCalled = true;
      return { installed: true, detail: "ok" };
    };
    installSkillsImpl = async () => {
      skillsCalled = true;
      return { installed: true, detail: "ok" };
    };

    const { warnings } = await syncToolchainFromGenesis(true);
    expect(warnings).toHaveLength(0);
    expect(openspecCalled).toBe(true);
    expect(skillsCalled).toBe(true);
  });
});
