import { checkSkillsCompatForGenesis, type SkillsCompat } from "./genesis-skills.js";
import { loadSkillsSpecFromConfig } from "./genesis-skills-spec.js";
import { printSkillsCompatToStderr } from "./skills-check.js";
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

export type CheckSkillsCompatFn = (spec: { source: string; ref: string }) => SkillsCompat;

/** Emit upgrade success payload and optional skills compat stderr hints. */
export async function emitUpgradeFinish(
  base: UpgradeResultBase,
  updated: boolean,
  deps?: {
    checkSkillsCompat?: CheckSkillsCompatFn;
    loadSkillsSpec?: () => Promise<{ source: string; ref: string } | null>;
  },
): Promise<void> {
  const loadSpec = deps?.loadSkillsSpec ?? loadSkillsSpecFromConfig;
  const check =
    deps?.checkSkillsCompat ?? ((spec) => checkSkillsCompatForGenesis(spec.source, spec.ref));

  let skillsCompat: SkillsCompat | undefined;
  if (updated) {
    const spec = await loadSpec();
    if (spec) {
      skillsCompat = check(spec);
    } else {
      skillsCompat = {
        status: "unknown",
        expectedSource: "",
        expectedRef: "",
        message: "No genesis skills configured locally (run probe genesis apply)",
        fixCommand: "probe genesis apply <path-to-genesis.json> --install-skills",
      };
    }
  }

  if (isJsonMode()) {
    success(skillsCompat ? { ...base, skillsCompat } : base);
    return;
  }

  success(base);
  if (skillsCompat) {
    printSkillsCompatToStderr(skillsCompat);
  }
}
