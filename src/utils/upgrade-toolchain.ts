import { checkOpenspecCompatForGenesis } from "~/utils/openspec-check.js";
import { checkSkillsCompatForGenesis } from "~/utils/genesis-skills.js";
import { loadSkillsSpecFromConfig } from "~/utils/genesis-skills-spec.js";
import { installOpenspec } from "~/utils/openspec-install.js";
import { installSkills } from "~/utils/skills-install.js";
import { compareSemver } from "~/utils/genesis-runtime.js";
import { loadUserConfig } from "~/utils/user-config.js";
import { probeVersion } from "~/probe-version.js";
import type { ToolchainComponentStatus } from "~/utils/openspec-check.js";

export interface ToolchainComponentReport {
  expected?: string;
  installed?: string;
  status: ToolchainComponentStatus;
  message?: string;
  fixCommand?: string;
}

export interface ToolchainReport {
  genesisConfigured: boolean;
  probe: ToolchainComponentReport;
  openspec?: ToolchainComponentReport;
  skills?: ToolchainComponentReport;
}

export interface SyncToolchainResult {
  report: ToolchainReport;
  warnings: string[];
}

function skillsExpectedLabel(source: string, ref: string): string {
  return `${source}@${ref}`;
}

export async function buildToolchainReport(): Promise<ToolchainReport> {
  const config = await loadUserConfig();
  const hasGenesis = Boolean(config.genesisHash || config.genesisSource);
  const installedProbe = probeVersion();

  const probeReport: ToolchainComponentReport = {
    installed: installedProbe,
    status: "ok",
  };

  if (config.minProbeVersion) {
    probeReport.expected = config.minProbeVersion;
    const cmp = compareSemver(installedProbe, config.minProbeVersion);
    if (cmp !== null && cmp < 0) {
      probeReport.status = "warn";
      probeReport.message = `Probe ${installedProbe} < minProbeVersion ${config.minProbeVersion}`;
      probeReport.fixCommand = "probe upgrade --yes";
    }
  }

  let openspecReport: ToolchainComponentReport | undefined;
  if (config.openspecVersion) {
    const compat = checkOpenspecCompatForGenesis(config.openspecVersion);
    openspecReport = {
      expected: compat.expected,
      installed: compat.installed,
      status: compat.status === "skipped" ? "unknown" : compat.status,
      message: compat.message,
      fixCommand: compat.fixCommand,
    };
  }

  let skillsReport: ToolchainComponentReport | undefined;
  const skillsSpec = await loadSkillsSpecFromConfig();
  if (skillsSpec) {
    const compat = checkSkillsCompatForGenesis(skillsSpec.source, skillsSpec.ref);
    skillsReport = {
      expected: skillsExpectedLabel(skillsSpec.source, skillsSpec.ref),
      installed: compat.foundRef ? `${compat.expectedSource}@${compat.foundRef}` : undefined,
      status: compat.status,
      message: compat.message,
      fixCommand: compat.fixCommand,
    };
  }

  return {
    genesisConfigured: hasGenesis,
    probe: probeReport,
    openspec: openspecReport,
    skills: skillsReport,
  };
}

export async function syncToolchainFromGenesis(install: boolean): Promise<SyncToolchainResult> {
  const warnings: string[] = [];
  const config = await loadUserConfig();

  if (!config.genesisHash && !config.genesisSource) {
    warnings.push("No local genesis configured — run probe genesis apply");
    return { report: await buildToolchainReport(), warnings };
  }

  if (install) {
    if (config.openspecVersion) {
      const result = await installOpenspec(config.openspecVersion);
      if (!result.installed) {
        warnings.push(result.detail + (result.recovery ? ` — ${result.recovery}` : ""));
      }
    }

    const skillsSpec = await loadSkillsSpecFromConfig();
    if (skillsSpec) {
      const result = await installSkills(skillsSpec);
      if (!result.installed) {
        warnings.push(result.detail + (result.recovery ? ` — ${result.recovery}` : ""));
      }
    }
  }

  return { report: await buildToolchainReport(), warnings };
}

export function formatToolchainHuman(report: ToolchainReport): string[] {
  const lines: string[] = [];
  const probeHint = report.probe.expected ? `(genesis min ${report.probe.expected})` : "";
  lines.push(
    `probe       ${report.probe.installed ?? "?"}  ${probeHint}  ${report.probe.status}`.trimEnd(),
  );

  if (report.openspec) {
    lines.push(
      `openspec    ${report.openspec.installed ?? "missing"}  (genesis pin ${report.openspec.expected ?? "?"})  ${report.openspec.status}`,
    );
  }

  if (report.skills) {
    lines.push(
      `skills      ${report.skills.installed ?? "unknown"}  (${report.skills.expected ?? "?"})  ${report.skills.status}`,
    );
  }

  return lines;
}
