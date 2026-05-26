import { compareSkillsReleaseRef } from "./skills-check.js";

export type SkillsRefCheckResult = {
  exitCode: number;
  lines: string[];
};

export function runSkillsRefCheck(options: {
  skillsSource: string;
  expectedRef: string;
  latestTag: string | null;
  strict?: boolean;
}): SkillsRefCheckResult {
  const { skillsSource, expectedRef, latestTag, strict } = options;
  const { status, message } = compareSkillsReleaseRef(skillsSource, expectedRef, latestTag);

  if (status === "match") {
    return { exitCode: 0, lines: [message] };
  }
  if (status === "unknown") {
    return { exitCode: strict ? 1 : 0, lines: [message] };
  }
  return { exitCode: strict ? 1 : 0, lines: [message] };
}
