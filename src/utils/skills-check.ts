import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SkillsCompatStatus = "ok" | "warn" | "unknown";

export interface SkillsCompat {
  status: SkillsCompatStatus;
  expectedSource: string;
  expectedRef: string;
  foundRef?: string;
  message: string;
  fixCommand: string;
}

export interface SkillLockEntry {
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

export function readSkillLockEntries(lockPath: string): SkillLockEntry[] | "missing" | "invalid" {
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

export type SkillsReleaseRefStatus = "match" | "mismatch" | "unknown";

/** Compare a genesis skills ref to the latest v* tag on the same skills repo. */
export function compareSkillsReleaseRef(
  skillsSource: string,
  expectedRef: string,
  latestTag: string | null,
): { status: SkillsReleaseRefStatus; message: string } {
  if (!latestTag) {
    return {
      status: "unknown",
      message: `Could not determine latest tag for ${skillsSource} (install gh or ensure git network access)`,
    };
  }
  if (latestTag === expectedRef) {
    return {
      status: "match",
      message: `skills-ref ok (${skillsSource}@${expectedRef})`,
    };
  }
  return {
    status: "mismatch",
    message: `skills-ref: genesis pins ${skillsSource}@${expectedRef}, latest tag is ${latestTag}\n  → bump skills.ref in genesis and re-apply`,
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
