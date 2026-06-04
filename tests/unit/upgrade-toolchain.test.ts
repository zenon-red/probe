import { beforeEach, describe, expect, it } from "bun:test";
import type { OpenspecCompat } from "../../src/utils/openspec-check.js";
import {
  buildToolchainReport,
  syncToolchainFromGenesis,
  type ToolchainDeps,
} from "../../src/utils/upgrade-toolchain.js";

function baseDeps(): ToolchainDeps {
  return {
    loadUserConfig: async () => ({}),
    probeVersion: () => "1.0.0",
    checkOpenspecCompatForGenesis: () => ({
      status: "ok",
      expected: "1.3.1",
      installed: "1.3.1",
      message: "ok",
      fixCommand: "probe upgrade --yes",
    }),
    checkSkillsCompatForGenesis: () => ({
      status: "ok",
      expectedSource: "acme/skills",
      expectedRef: "v1.0.0",
      foundRef: "v1.0.0",
      message: "ok",
      fixCommand: "npx skills add acme/skills#v1.0.0 --skill='*' -y -g",
    }),
    loadSkillsSpecFromConfig: async () => null,
    installOpenspec: async () => ({ installed: true, detail: "ok" }),
    installSkills: async () => ({ installed: true, detail: "ok" }),
  };
}

let deps: ToolchainDeps;

beforeEach(() => {
  deps = baseDeps();
});

describe("buildToolchainReport", () => {
  it("reports warn when probe is below minProbeVersion", async () => {
    deps.loadUserConfig = async () => ({ genesisHash: "abc", minProbeVersion: "2.0.0" });

    const report = await buildToolchainReport(deps);
    expect(report.probe.status).toBe("warn");
    expect(report.probe.expected).toBe("2.0.0");
  });

  it("includes openspec when pinned", async () => {
    deps.loadUserConfig = async () => ({ genesisHash: "abc", openspecVersion: "1.3.1" });
    deps.checkOpenspecCompatForGenesis = () =>
      ({
        status: "warn",
        expected: "1.3.1",
        message: "OpenSpec not installed",
        fixCommand: "probe upgrade --yes",
      }) satisfies OpenspecCompat;

    const report = await buildToolchainReport(deps);
    expect(report.openspec?.status).toBe("warn");
  });
});

describe("syncToolchainFromGenesis", () => {
  it("warns when no genesis is configured", async () => {
    const { warnings } = await syncToolchainFromGenesis(true, deps);
    expect(warnings[0]).toContain("No local genesis configured");
  });

  it("installs openspec and skills when requested", async () => {
    let openspecCalled = false;
    let skillsCalled = false;
    deps.loadUserConfig = async () => ({
      genesisSource: "/genesis.json",
      openspecVersion: "1.3.1",
    });
    deps.loadSkillsSpecFromConfig = async () => ({ source: "acme/skills", ref: "v1.0.0" });
    deps.installOpenspec = async () => {
      openspecCalled = true;
      return { installed: true, detail: "ok" };
    };
    deps.installSkills = async () => {
      skillsCalled = true;
      return { installed: true, detail: "ok" };
    };

    await syncToolchainFromGenesis(true, deps);
    expect(openspecCalled).toBe(true);
    expect(skillsCalled).toBe(true);
  });
});
