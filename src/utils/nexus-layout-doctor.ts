import { access } from "node:fs/promises";
import type { DoctorIssue } from "~/utils/doctor-issues.js";
import { nexusRoot } from "~/utils/nexus-paths.js";

export async function runNexusLayoutDoctorChecks(
  addIssue: (issue: DoctorIssue) => void,
): Promise<void> {
  try {
    await access(nexusRoot());
  } catch {
    addIssue({
      code: "NEXUS_ROOT_MISSING",
      severity: "warn",
      message: `${nexusRoot()} does not exist`,
      recommendation: "Run probe onboard to create the local Nexus directory",
      fix_command: 'probe onboard --name "<display-name>"',
    });
  }
}
