import { EXPECTED_SKILLS_REF, compareSkillsReleaseRef } from "./skills-check.js";

export interface SkillsRefCheckResult {
  exitCode: number;
  lines: string[];
}

export function runSkillsRefCheck(options: {
  expectedRef?: string;
  latestTag: string | null;
  strict: boolean;
}): SkillsRefCheckResult {
  const expectedRef = options.expectedRef ?? EXPECTED_SKILLS_REF;
  const { status, message } = compareSkillsReleaseRef(expectedRef, options.latestTag);
  const lines = [message];

  if (status === "match") {
    return { exitCode: 0, lines };
  }

  if (status === "mismatch") {
    return { exitCode: options.strict ? 1 : 0, lines };
  }

  return { exitCode: options.strict ? 1 : 0, lines };
}
