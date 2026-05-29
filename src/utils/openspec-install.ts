import { execFileSync, execSync } from "node:child_process";
import { commandExists } from "~/utils/system.js";
import { SHELL_TIMEOUT } from "~/utils/timeouts.js";

export const OPENSPEC_NPM_PACKAGE = "@fission-ai/openspec";

export interface OpenspecResult {
  installed: boolean;
  detail: string;
  recovery?: string;
  version?: string;
}

export function validateOpenspecVersion(version: string): string {
  const trimmed = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(`openspec.version must be exact semver major.minor.patch (got '${version}')`);
  }
  return trimmed;
}

export function openspecInstallCommand(version: string): string {
  const pin = validateOpenspecVersion(version);
  return `npm install -g ${OPENSPEC_NPM_PACKAGE}@${pin}`;
}

export function detectOpenspecVersion(): string | undefined {
  if (commandExists("openspec")) {
    try {
      const out = execSync("openspec --version", {
        encoding: "utf-8",
        timeout: SHELL_TIMEOUT.SHORT,
      }).trim();
      const match = /(\d+\.\d+\.\d+)/.exec(out);
      if (match) return match[1];
    } catch {}
  }

  if (!commandExists("npm")) return undefined;

  try {
    const out = execSync(`npm list -g ${OPENSPEC_NPM_PACKAGE} --depth=0 --json`, {
      encoding: "utf-8",
      timeout: SHELL_TIMEOUT.MEDIUM,
    });
    const parsed = JSON.parse(out) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const version = parsed.dependencies?.[OPENSPEC_NPM_PACKAGE]?.version;
    if (!version) return undefined;
    const match = /(\d+\.\d+\.\d+)/.exec(version);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export async function installOpenspec(version: string): Promise<OpenspecResult> {
  const pin = validateOpenspecVersion(version);
  const recovery = openspecInstallCommand(pin);

  if (!commandExists("npm")) {
    return {
      installed: false,
      detail: "npm not found in PATH",
      recovery: "Install Node.js/npm to enable OpenSpec installation",
    };
  }

  try {
    execFileSync("npm", ["install", "-g", `${OPENSPEC_NPM_PACKAGE}@${pin}`], {
      stdio: "ignore",
      timeout: SHELL_TIMEOUT.VERY_LONG,
    });
    const installed = detectOpenspecVersion();
    return {
      installed: true,
      detail: installed
        ? `Installed ${OPENSPEC_NPM_PACKAGE}@${installed}`
        : `Installed ${OPENSPEC_NPM_PACKAGE}@${pin}`,
      version: installed ?? pin,
    };
  } catch {
    return {
      installed: false,
      detail: "OpenSpec install command failed",
      recovery,
    };
  }
}
