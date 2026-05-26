import {
  getSkillLockPath,
  readSkillLockEntries,
  type SkillsCompat,
  type SkillsCompatStatus,
} from "~/utils/skills-check.js";

export interface SkillsSpec {
  source: string;
  ref: string;
}

export function validateSkillsSpec(source: string, ref: string): SkillsSpec {
  const normalized = { source: source.trim(), ref: ref.trim() };
  const sourcePattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/;
  const refPattern = /^[A-Za-z0-9._/-]+$/;

  if (!sourcePattern.test(normalized.source)) {
    throw new Error("skills.source must be a GitHub owner/repo slug");
  }
  if (
    !refPattern.test(normalized.ref) ||
    normalized.ref.includes("..") ||
    normalized.ref.includes("@{") ||
    normalized.ref.startsWith("/") ||
    normalized.ref.endsWith("/")
  ) {
    throw new Error("skills.ref must be a safe git ref");
  }
  return normalized;
}

export function skillsInstallCommand(source: string, ref: string): string {
  const spec = validateSkillsSpec(source, ref);
  return `npx skills add ${spec.source}#${spec.ref} --skill='*' -y -g`;
}

export function skillsInstallArgs(spec: SkillsSpec): string[] {
  const safe = validateSkillsSpec(spec.source, spec.ref);
  return ["skills", "add", `${safe.source}#${safe.ref}`, "--skill=*", "-y", "-g"];
}

export function checkSkillsCompatForGenesis(
  source: string,
  ref: string,
  options?: { lockPath?: string },
): SkillsCompat {
  const lockPath = options?.lockPath ?? getSkillLockPath();
  const lockEntries = readSkillLockEntries(lockPath);
  const fixCommand = skillsInstallCommand(source, ref);

  if (lockEntries === "missing") {
    return {
      status: "unknown",
      expectedSource: source,
      expectedRef: ref,
      message: `Skills lock not found at ${lockPath}`,
      fixCommand,
    };
  }

  if (lockEntries === "invalid") {
    return {
      status: "unknown",
      expectedSource: source,
      expectedRef: ref,
      message: "Skills lock unreadable",
      fixCommand,
    };
  }

  const entries = lockEntries.filter((entry) => entry.source === source);
  if (entries.length === 0) {
    return {
      status: "unknown",
      expectedSource: source,
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
      expectedSource: source,
      expectedRef: ref,
      message: `Skills install is not pinned to ${ref}`,
      fixCommand,
    };
  }

  const distinctRefs = [...new Set(refs as string[])];
  if (distinctRefs.length > 1) {
    return {
      status: "warn",
      expectedSource: source,
      expectedRef: ref,
      foundRef: distinctRefs.find((r) => r !== ref) ?? distinctRefs[0],
      message: `Skills refs are inconsistent (expected ${ref})`,
      fixCommand,
    };
  }

  const foundRef = distinctRefs[0]!;
  if (foundRef !== ref) {
    return {
      status: "warn",
      expectedSource: source,
      expectedRef: ref,
      foundRef,
      message: `Skills ref mismatch: expected ${ref}, found ${foundRef}`,
      fixCommand,
    };
  }

  return {
    status: "ok",
    expectedSource: source,
    expectedRef: ref,
    foundRef,
    message: `Skills compatible (${source}@${ref})`,
    fixCommand,
  };
}

export type { SkillsCompat, SkillsCompatStatus };
