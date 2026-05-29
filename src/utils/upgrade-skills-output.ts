import {
  buildToolchainReport,
  formatToolchainHuman,
  syncToolchainFromGenesis,
  type ToolchainReport,
} from "./upgrade-toolchain.js";
import { isJsonMode, success } from "./output.js";

export interface UpgradeResultBase {
  method: string;
  currentVersion: string;
  targetVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updated: boolean;
  checkOnly: boolean;
}

export interface UpgradeFinishOptions {
  syncStack?: boolean;
  checkOnly?: boolean;
}

export interface UpgradeFinishDeps {
  buildToolchainReport?: typeof buildToolchainReport;
  syncToolchainFromGenesis?: typeof syncToolchainFromGenesis;
  formatToolchainHuman?: typeof formatToolchainHuman;
}

export async function emitUpgradeFinish(
  base: UpgradeResultBase,
  options: UpgradeFinishOptions = {},
  deps?: UpgradeFinishDeps,
): Promise<void> {
  const checkOnly = options.checkOnly ?? base.checkOnly;
  const syncStack = !checkOnly && options.syncStack === true;
  const buildReport = deps?.buildToolchainReport ?? buildToolchainReport;
  const syncToolchain = deps?.syncToolchainFromGenesis ?? syncToolchainFromGenesis;
  const formatHuman = deps?.formatToolchainHuman ?? formatToolchainHuman;

  let toolchain: ToolchainReport | undefined;
  let warnings: string[] = [];

  if (checkOnly) {
    toolchain = await buildReport();
  } else if (syncStack) {
    const result = await syncToolchain(true);
    toolchain = result.report;
    warnings = result.warnings;
  } else {
    toolchain = await buildReport();
  }

  const payload = {
    ...base,
    toolchain,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  if (isJsonMode()) {
    success(payload);
    return;
  }

  success(base);
  if (toolchain) {
    for (const line of formatHuman(toolchain)) {
      console.error(line);
    }
  }
  for (const warning of warnings) {
    console.error(`⚠ ${warning}`);
  }
}
