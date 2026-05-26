import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const EXPECTED_SKILLS_SOURCE = "zenon-red/skills";
export const EXPECTED_SKILLS_REF = "v0.3.4";
export const SKILLS_INSTALL_CMD = `npx skills add ${EXPECTED_SKILLS_SOURCE}#${EXPECTED_SKILLS_REF} --skill='*' -y -g`;

export type SkillsCompatStatus = "ok" | "warn" | "unknown";

export interface SkillsCompat {
  status: SkillsCompatStatus;
  expectedRef: string;
  foundRef?: string;
  message: string;
  fixCommand: string;
}

interface SkillLockEntry {
  source?: string;
  ref?: string;
}

function isSkillLockEntry(value: unknown): value is SkillLockEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (entry.source !== undefined && typeof entry.source !== "string") {
    return false;
  }
  if (entry.ref !== undefined && typeof entry.ref !== "string") {
    return false;
  }
  return true;
}

function readSkillLockEntries(lockPath: string): SkillLockEntry[] | "missing" | "invalid" {
  if (!existsSync(lockPath)) {
    return "missing";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return "invalid";
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "invalid";
  }

  const skills = (parsed as { skills?: unknown }).skills;
  if (
    skills === undefined ||
    typeof skills !== "object" ||
    skills === null ||
    Array.isArray(skills)
  ) {
    return "invalid";
  }

  return Object.values(skills).filter(isSkillLockEntry);
}

export function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, "skills", ".skill-lock.json");
  }
  return join(homedir(), ".agents", ".skill-lock.json");
}

export function checkSkillsCompat(options?: { lockPath?: string }): SkillsCompat {
  const fixCommand = SKILLS_INSTALL_CMD;
  const lockPath = options?.lockPath ?? getSkillLockPath();
  const lockEntries = readSkillLockEntries(lockPath);

  if (lockEntries === "missing") {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: `Skills lock not found at ${lockPath}`,
      fixCommand,
    };
  }

  if (lockEntries === "invalid") {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: "Skills lock unreadable",
      fixCommand,
    };
  }

  const entries = lockEntries.filter((entry) => entry.source === EXPECTED_SKILLS_SOURCE);

  if (entries.length === 0) {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: `No ${EXPECTED_SKILLS_SOURCE} entries in lock`,
      fixCommand,
    };
  }

  const refs = entries.map((entry) => entry.ref);
  const hasMissingRef = refs.some((ref) => ref === undefined || ref === "");
  if (hasMissingRef) {
    return {
      status: "warn",
      expectedRef: EXPECTED_SKILLS_REF,
      message: `Skills install is not pinned to ${EXPECTED_SKILLS_REF}`,
      fixCommand,
    };
  }

  const distinctRefs = [...new Set(refs as string[])];
  if (distinctRefs.length > 1) {
    return {
      status: "warn",
      expectedRef: EXPECTED_SKILLS_REF,
      foundRef: distinctRefs.find((ref) => ref !== EXPECTED_SKILLS_REF) ?? distinctRefs[0],
      message: `Skills refs are inconsistent (expected ${EXPECTED_SKILLS_REF})`,
      fixCommand,
    };
  }

  const foundRef = distinctRefs[0]!;
  if (foundRef !== EXPECTED_SKILLS_REF) {
    return {
      status: "warn",
      expectedRef: EXPECTED_SKILLS_REF,
      foundRef,
      message: `Skills ref mismatch: expected ${EXPECTED_SKILLS_REF}, found ${foundRef}`,
      fixCommand,
    };
  }

  return {
    status: "ok",
    expectedRef: EXPECTED_SKILLS_REF,
    foundRef,
    message: `Skills compatible (ref: ${EXPECTED_SKILLS_REF})`,
    fixCommand,
  };
}

export type SkillsReleaseRefStatus = "match" | "mismatch" | "unknown";

/** Compare probe-bundled ref to latest zenon-red/skills v* tag (release reminder). */
export function compareSkillsReleaseRef(
  expectedRef: string,
  latestTag: string | null,
): { status: SkillsReleaseRefStatus; message: string } {
  if (!latestTag) {
    return {
      status: "unknown",
      message:
        "Could not determine latest zenon-red/skills tag (install gh or ensure git network access)",
    };
  }
  if (latestTag === expectedRef) {
    return { status: "match", message: `skills-ref ok (${expectedRef})` };
  }
  return {
    status: "mismatch",
    message: `skills-ref: probe expects ${expectedRef}, zenon-red/skills latest tag is ${latestTag}\n  → bump EXPECTED_SKILLS_REF in src/utils/skills-check.ts if this release needs it`,
  };
}

/** Pick highest v* tag from a list (e.g. git tag names). */
export function pickLatestVTag(tags: string[]): string | null {
  const versionTags = tags
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+/.test(tag))
    .map((tag) => ({ tag, parts: parseVersionTag(tag) }))
    .filter((entry): entry is { tag: string; parts: number[] } => entry.parts !== null);

  if (versionTags.length === 0) {
    return null;
  }

  versionTags.sort((a, b) => compareVersionParts(a.parts, b.parts));
  return versionTags[versionTags.length - 1]!.tag;
}

function parseVersionTag(tag: string): number[] | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionParts(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function printSkillsCompatToStderr(compat: SkillsCompat): void {
  if (compat.status === "ok") {
    console.error(`✓ ${compat.message}`);
    return;
  }
  console.error(`⚠ ${compat.message}`);
  console.error(`  Run: ${compat.fixCommand}`);
}
