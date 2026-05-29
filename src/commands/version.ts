import { defineCommand } from "citty";
import { forceHelpRequested, JSON_FLAG_ARG_DESCRIPTION, printHelp } from "~/utils/help.js";
import { checkSkillsCompatForGenesis } from "~/utils/genesis-skills.js";
import { loadUserConfig } from "~/utils/user-config.js";
import { detectOpenspecVersion } from "~/utils/openspec-install.js";
import { probeVersion } from "~/probe-version.js";
import { applyJsonMode, success } from "~/utils/output.js";

export type VersionReport = {
  probe: string;
  skills: string | null;
  openspec: string | null;
  openspecPin: string | null;
};

export async function buildVersionReport(): Promise<VersionReport> {
  const config = await loadUserConfig();

  let skills: string | null = null;
  if (config.skillsSource?.trim() && config.skillsRef?.trim()) {
    const source = config.skillsSource.trim();
    const ref = config.skillsRef.trim();
    const compat = checkSkillsCompatForGenesis(source, ref);
    skills = compat.foundRef ? `${source}@${compat.foundRef}` : `${source}@${ref}`;
  }

  const openspecPin = config.openspecVersion?.trim() ?? null;
  const openspec = detectOpenspecVersion() ?? null;

  return {
    probe: probeVersion(),
    skills,
    openspec,
    openspecPin,
  };
}

export default defineCommand({
  meta: {
    name: "version",
    description: "Report probe, skills, and OpenSpec versions",
  },
  args: {
    json: {
      type: "boolean",
      description: JSON_FLAG_ARG_DESCRIPTION,
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (forceHelpRequested()) {
      printHelp({
        command: "probe version",
        description: "Report installed probe, skills (source@ref), and OpenSpec versions",
        usage: ["probe version", "probe version --json"],
        notes: ["Use probe --version for probe semver only (scripting)."],
      });
      return;
    }

    success(await buildVersionReport());
  },
});
