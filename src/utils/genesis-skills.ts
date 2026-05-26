import { existsSync, readFileSync } from "node:fs";
import {
  checkSkillsCompat,
  getSkillLockPath,
  type SkillsCompat,
  type SkillsCompatStatus,
} from "~/utils/skills-check.js";

export function skillsInstallCommand(source: string, ref: string): string {
  return `npx skills add ${source}#${ref} --skill='*' -y -g`;
}

export function checkSkillsCompatForGenesis(source: string, ref: string): SkillsCompat {
  const lockPath = getSkillLockPath();
  const lockEntries = readSkillLockEntries(lockPath);
  const fixCommand = skillsInstallCommand(source, ref);

  if (lockEntries === "missing") {
    return {
      status: "unknown",
      expectedRef: ref,
      message: `Skills lock not found at ${lockPath}`,
      fixCommand,
    };
  }

  if (lockEntries === "invalid") {
    return {
      status: "unknown",
      expectedRef: ref,
      message: "Skills lock unreadable",
      fixCommand,
    };
  }

  const entries = lockEntries.filter((entry) => entry.source === source);
  if (entries.length === 0) {
    return {
      status: "unknown",
      expectedRef: ref,
      message: `No ${source} entries in lock`,
      fixCommand,
    };
  }

  const refs = entries.map((entry) => entry.ref);
  const hasMissingRef = refs.some((r) => r === undefined || r === "");
  if (hasMissingRef) {
    return {
      status: "warn",
      expectedRef: ref,
      message: `Skills install is not pinned to ${ref}`,
      fixCommand,
    };
  }

  const distinctRefs = [...new Set(refs as string[])];
  if (distinctRefs.length > 1 || distinctRefs[0] !== ref) {
    return {
      status: "warn",
      expectedRef: ref,
      foundRef: distinctRefs[0],
      message: `Skills ref mismatch: expected ${ref}, found ${distinctRefs.join(",")}`,
      fixCommand,
    };
  }

  return {
    status: "ok",
    expectedRef: ref,
    foundRef: ref,
    message: `Skills compatible (${source}@${ref})`,
    fixCommand,
  };
}

interface SkillLockEntry {
  source?: string;
  ref?: string;
}

function readSkillLockEntries(lockPath: string): SkillLockEntry[] | "missing" | "invalid" {
  if (!existsSync(lockPath)) return "missing";
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { skills?: unknown };
    const skills = parsed.skills;
    if (skills === null || typeof skills !== "object" || Array.isArray(skills)) {
      return "invalid";
    }
    return Object.values(skills).filter(
      (e): e is SkillLockEntry => e !== null && typeof e === "object" && !Array.isArray(e),
    );
  } catch {
    return "invalid";
  }
}

export { checkSkillsCompat, type SkillsCompat, type SkillsCompatStatus };
