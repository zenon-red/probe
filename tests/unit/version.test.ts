import { describe, expect, test, mock, spyOn } from "bun:test";
import * as userConfig from "../../src/utils/user-config.js";
import * as genesisSkills from "../../src/utils/genesis-skills.js";
import * as openspecInstall from "../../src/utils/openspec-install.js";
import * as probeVersionModule from "../../src/probe-version.js";
import { buildVersionReport } from "../../src/commands/version.js";

describe("buildVersionReport", () => {
  test("returns probe, skills@ref, and openspec", async () => {
    spyOn(userConfig, "loadUserConfig").mockResolvedValue({
      skillsSource: "zenon-red/skills",
      skillsRef: "v0.3.7",
      openspecVersion: "1.3.1",
    });
    spyOn(probeVersionModule, "probeVersion").mockReturnValue("1.3.9");
    spyOn(genesisSkills, "checkSkillsCompatForGenesis").mockReturnValue({
      status: "ok",
      expectedSource: "zenon-red/skills",
      expectedRef: "v0.3.7",
      foundRef: "v0.3.7",
      message: "ok",
      fixCommand: "npx skills add zenon-red/skills#v0.3.7 --skill=\'*\' -y -g",
    });
    spyOn(openspecInstall, "detectOpenspecVersion").mockReturnValue("1.3.1");

    await expect(buildVersionReport()).resolves.toEqual({
      probe: "1.3.9",
      skills: "zenon-red/skills@v0.3.7",
      openspec: "1.3.1",
      openspecPin: "1.3.1",
    });

    mock.restore();
  });

  test("falls back to genesis pins when tools are not installed", async () => {
    spyOn(userConfig, "loadUserConfig").mockResolvedValue({
      skillsSource: "zenon-red/skills",
      skillsRef: "v0.3.7",
      openspecVersion: "1.3.1",
    });
    spyOn(probeVersionModule, "probeVersion").mockReturnValue("1.3.9");
    spyOn(genesisSkills, "checkSkillsCompatForGenesis").mockReturnValue({
      status: "unknown",
      expectedSource: "zenon-red/skills",
      expectedRef: "v0.3.7",
      message: "missing",
      fixCommand: "npx skills add zenon-red/skills#v0.3.7 --skill=\'*\' -y -g",
    });
    spyOn(openspecInstall, "detectOpenspecVersion").mockReturnValue(undefined);

    await expect(buildVersionReport()).resolves.toEqual({
      probe: "1.3.9",
      skills: "zenon-red/skills@v0.3.7",
      openspec: null,
      openspecPin: "1.3.1",
    });

    mock.restore();
  });
});
