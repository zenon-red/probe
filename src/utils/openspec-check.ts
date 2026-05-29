import {
  detectOpenspecVersion,
  openspecInstallCommand,
  OPENSPEC_NPM_PACKAGE,
  validateOpenspecVersion,
} from "~/utils/openspec-install.js";

export type ToolchainComponentStatus = "ok" | "warn" | "unknown" | "skipped";

export interface OpenspecCompat {
  status: ToolchainComponentStatus;
  expected?: string;
  installed?: string;
  message: string;
  fixCommand: string;
}

export function checkOpenspecCompatForGenesis(expectedVersion: string): OpenspecCompat {
  const expected = validateOpenspecVersion(expectedVersion);
  const fixCommand = "probe upgrade --yes";
  const installed = detectOpenspecVersion();

  if (!installed) {
    return {
      status: "warn",
      expected,
      message: `OpenSpec not installed (genesis pin ${expected})`,
      fixCommand,
    };
  }

  if (installed !== expected) {
    return {
      status: "warn",
      expected,
      installed,
      message: `OpenSpec version mismatch: expected ${expected}, found ${installed}`,
      fixCommand,
    };
  }

  return {
    status: "ok",
    expected,
    installed,
    message: `OpenSpec compatible (${OPENSPEC_NPM_PACKAGE}@${installed})`,
    fixCommand: openspecInstallCommand(expected),
  };
}
