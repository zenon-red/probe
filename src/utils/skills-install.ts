import { execSync } from "node:child_process";
import { commandExists } from "./system.js";
import { SHELL_TIMEOUT } from "./timeouts.js";

export interface SkillsResult {
  installed: boolean;
  detail: string;
  recovery?: string;
}

export async function installSkills(): Promise<SkillsResult> {
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
      recovery: "Run: npm install -g @zenon-red/skills-cli",
    };
  }
  try {
    execSync("npx skills add zenon-red/skills --skill='*' -y -g", {
      stdio: "ignore",
      timeout: SHELL_TIMEOUT.VERY_LONG,
    });
    return {
      installed: true,
      detail: "Installed zenon-red/skills globally",
    };
  } catch {
    return {
      installed: false,
      detail: "skills add command failed",
      recovery: "Run manually: npx skills add zenon-red/skills --skill='*' -y -g",
    };
  }
}

export async function verifySkills(): Promise<SkillsResult> {
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
      recovery: "Run: npx skills add zenon-red/skills --skill='*' -y -g",
    };
  }
}
