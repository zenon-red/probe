import type { Agent, CommandContext } from "~/utils/context.js";
import type { DoctorIssue } from "~/utils/doctor-issues.js";
import { enumName } from "~/utils/enums.js";
import { compareSemver, computeSyncStatus } from "~/utils/genesis-runtime.js";
import { probeVersion } from "~/probe-version.js";
import { checkSkillsCompatForGenesis } from "~/utils/genesis-skills.js";
import type { NexusConfig } from "~/types/config.js";

const GITHUB_CAPABILITIES = new Set([
  "idea.propose",
  "idea.vote",
  "task.execute",
  "task.review",
  "artifact.register",
]);

function agentNeedsGithubAuth(agent: Agent | null): boolean {
  if (!agent) return false;
  return agent.capabilities.some((c) => GITHUB_CAPABILITIES.has(c));
}

export function runGenesisDoctorChecks(
  ctx: CommandContext,
  config: NexusConfig,
  agent: Agent | null,
  addIssue: (issue: DoctorIssue) => void,
): void {
  const applied = ctx.appliedGenesis.find((r) => r.id === "active") ?? ctx.appliedGenesis[0];

  if (!config.genesisHash) {
    addIssue({
      code: "GENESIS_LOCAL_MISSING",
      severity: "warn",
      message: "No local Genesis hash configured",
      recommendation: "Run probe genesis apply with your org manifest",
      fix_command: "probe genesis apply /opt/nexus-genesis/genesis.json",
    });
  }

  if (!applied) {
    addIssue({
      code: "GENESIS_NEXUS_NOT_APPLIED",
      severity: "warn",
      message: "Nexus has no applied Genesis row",
      recommendation:
        "Operator applies genesis (lab: apply-genesis.sh or probe genesis apply --push-to-nexus)",
      fix_command: "probe genesis apply <path> --push-to-nexus",
    });
    return;
  }

  if (config.genesisHash && config.genesisHash !== applied.genesisHash) {
    addIssue({
      code: "GENESIS_HASH_DRIFT",
      severity: "fail",
      message: `Local genesis hash differs from Nexus applied (${applied.genesisHash.slice(0, 12)}…)`,
      recommendation: "Re-sync local Genesis or re-apply on Nexus",
      fix_command: "probe genesis sync",
    });
  }

  if (config.githubOrg && config.githubOrg !== applied.githubOrg) {
    addIssue({
      code: "GENESIS_ORG_MISMATCH",
      severity: "fail",
      message: `Local githubOrg ${config.githubOrg} != applied ${applied.githubOrg}`,
      fix_command: "probe genesis sync",
    });
  }

  if (config.skillsSource && config.skillsSource !== applied.skillsSource) {
    addIssue({
      code: "GENESIS_SKILLS_SOURCE_MISMATCH",
      severity: "fail",
      message: `Local skills source ${config.skillsSource} != applied ${applied.skillsSource}`,
      fix_command: "probe genesis sync",
    });
  }

  if (config.skillsRef && config.skillsRef !== applied.skillsRef) {
    addIssue({
      code: "GENESIS_SKILLS_REF_MISMATCH",
      severity: "fail",
      message: `Local skills ref ${config.skillsRef} != applied ${applied.skillsRef}`,
      fix_command: checkSkillsCompatForGenesis(applied.skillsSource, applied.skillsRef).fixCommand,
    });
  }

  const skills = checkSkillsCompatForGenesis(applied.skillsSource, applied.skillsRef);
  if (skills.status !== "ok") {
    addIssue({
      code: "GENESIS_SKILLS_LOCK",
      severity: "warn",
      message: skills.message,
      fix_command: skills.fixCommand,
    });
  }

  if (applied.minProbeVersion) {
    const cmp = compareSemver(probeVersion(), applied.minProbeVersion);
    if (cmp !== null && cmp < 0) {
      addIssue({
        code: "PROBE_VERSION_BELOW_MIN",
        severity: "fail",
        message: `Probe ${probeVersion()} < minProbeVersion ${applied.minProbeVersion}`,
        fix_command: "probe upgrade",
      });
    }
  }

  const { status, syncError } = computeSyncStatus({
    localHash: config.genesisHash,
    applied: {
      genesisHash: applied.genesisHash,
      skillsSource: applied.skillsSource,
      skillsRef: applied.skillsRef,
      minProbeVersion: applied.minProbeVersion ?? undefined,
      githubOrg: applied.githubOrg,
    },
    localProbeVersion: probeVersion(),
    localSkillsSource: config.skillsSource,
    localSkillsRef: config.skillsRef,
  });

  const syncTag = enumName(status);
  if (syncTag !== "Synced") {
    addIssue({
      code: `GENESIS_SYNC_${syncTag.toUpperCase()}`,
      severity: syncTag === "ProbeUpgradeRequired" ? "fail" : "warn",
      message: syncError ?? `sync_status is ${syncTag}`,
      fix_command:
        syncTag === "ProbeUpgradeRequired"
          ? "probe upgrade"
          : syncTag === "SkillsUpgradeRequired"
            ? skills.fixCommand
            : "probe genesis sync",
    });
  }

  if (agentNeedsGithubAuth(agent)) {
    if (!process.env.GH_TOKEN?.trim()) {
      addIssue({
        code: "GH_TOKEN_MISSING",
        severity: "fail",
        message: "GH_TOKEN is required for GitHub artifact routes (GITHUB_TOKEN is not accepted)",
        recommendation: "Export GH_TOKEN for gh CLI in agent containers",
      });
    }
  }
}
