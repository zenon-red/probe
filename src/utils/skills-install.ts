import { execFileSync, execSync } from "node:child_process";
import type { SkillsSpec } from "~/utils/genesis-skills.js";
import { skillsInstallArgs, skillsInstallCommand } from "~/utils/genesis-skills.js";
import { formatSkillsSpec } from "~/utils/genesis-skills-spec.js";
import { commandExists } from "~/utils/system.js";
import { SHELL_TIMEOUT } from "~/utils/timeouts.js";

export interface SkillsResult {
  installed: boolean;
  detail: string;
  recovery?: string;
}

export async function installSkills(spec: SkillsSpec): Promise<SkillsResult> {
  const installCmd = skillsInstallCommand(spec.source, spec.ref);

  if (!commandExists("npx")) {
    return {
      installed: false,
      detail: "npx not found in PATH",
      recovery: "Install Node.js/npm to enable skills installation",
    };
  }
  try {
    execSync("npx skills list -g", { stdio: "ignore", timeout: SHELL_TIMEOUT.LONG });
  } catch {
    return {
      installed: false,
      detail: "skills CLI not available",
      recovery: "Install the skills CLI package for your environment",
    };
  }
  try {
    execFileSync("npx", skillsInstallArgs(spec), {
      stdio: "ignore",
      timeout: SHELL_TIMEOUT.VERY_LONG,
    });
    return {
      installed: true,
      detail: `Installed ${formatSkillsSpec(spec)} globally`,
    };
  } catch {
    return {
      installed: false,
      detail: "skills add command failed",
      recovery: `Run manually: ${installCmd}`,
    };
  }
}

export async function verifySkillsCli(): Promise<SkillsResult> {
  if (!commandExists("npx")) {
    return {
      installed: false,
      detail: "npx not found in PATH",
    };
  }
  try {
    execSync("npx skills list -g", { stdio: "ignore", timeout: SHELL_TIMEOUT.LONG });
    return {
      installed: true,
      detail: "skills CLI available",
    };
  } catch {
    return {
      installed: false,
      detail: "skills CLI not available or empty",
    };
  }
}
