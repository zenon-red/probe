import { loadUserConfig } from "~/utils/user-config.js";
import { validateSkillsSpec, type SkillsSpec } from "~/utils/genesis-skills.js";

export type { SkillsSpec };

export async function loadSkillsSpecFromConfig(): Promise<SkillsSpec | null> {
  const config = await loadUserConfig();
  if (!config.skillsSource?.trim() || !config.skillsRef?.trim()) {
    return null;
  }
  return validateSkillsSpec(config.skillsSource, config.skillsRef);
}

export function formatSkillsSpec(spec: SkillsSpec): string {
  return `${spec.source}@${spec.ref}`;
}
