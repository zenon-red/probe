import { type SkillsCompat, checkSkillsCompat, printSkillsCompatToStderr } from "./skills-check.js";
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

export type CheckSkillsCompatFn = (options?: { lockPath?: string }) => SkillsCompat;

/** Emit upgrade success payload and optional skills compat stderr hints. */
export function emitUpgradeFinish(
  base: UpgradeResultBase,
  updated: boolean,
  deps?: {
    checkSkillsCompat?: CheckSkillsCompatFn;
    lockPath?: string;
  },
): void {
  const check = deps?.checkSkillsCompat ?? checkSkillsCompat;
  const skillsCompat = updated
    ? check(deps?.lockPath ? { lockPath: deps.lockPath } : undefined)
    : undefined;

  if (isJsonMode()) {
    success(skillsCompat ? { ...base, skillsCompat } : base);
    return;
  }

  success(base);
  if (skillsCompat) {
    printSkillsCompatToStderr(skillsCompat);
  }
}
