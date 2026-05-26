import { createRequire } from "node:module";
import type { AgentSyncStatus } from "~/module_bindings/types.js";
import type { Agent } from "~/utils/context.js";
import { enumName } from "~/utils/enums.js";
import type { ParsedGenesisManifest } from "~/utils/genesis-manifest.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import type { NexusConfig } from "~/types/config.js";
import { checkSkillsCompatForGenesis } from "~/utils/genesis-skills.js";

const require = createRequire(import.meta.url);
const { version: PROBE_VERSION } = require("../../package.json") as { version: string };

export type GenesisLocalConfig = {
  genesisSource?: string;
  genesisUrl?: string;
  genesisHash?: string;
  genesisId?: string;
  genesisVersion?: string;
  githubOrg?: string;
  orgName?: string;
  skillsSource?: string;
  skillsRef?: string;
  minProbeVersion?: string;
  promptMarkerTemplate?: string;
};

export function parseSemverParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const diff = pa[i]! - pb[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

export function assertMinProbeVersion(minProbeVersion: string | undefined): void {
  if (!minProbeVersion) return;
  const cmp = compareSemver(PROBE_VERSION, minProbeVersion);
  if (cmp === null) {
    throw new Error(
      `Cannot compare Probe version ${PROBE_VERSION} to minProbeVersion ${minProbeVersion}`,
    );
  }
  if (cmp < 0) {
    throw new Error(
      `Probe ${PROBE_VERSION} is below genesis minProbeVersion ${minProbeVersion}. Run: probe upgrade`,
    );
  }
}

export function probeVersion(): string {
  return PROBE_VERSION;
}

export async function loadGenesisLocalConfig(): Promise<GenesisLocalConfig & Partial<NexusConfig>> {
  return loadUserConfig();
}

export async function persistGenesisLocal(
  parsed: ParsedGenesisManifest,
  persistedSource: string,
): Promise<void> {
  const existing = await loadUserConfig();
  await saveUserConfig({
    ...existing,
    issuer: parsed.issuer,
    genesisSource: persistedSource,
    genesisUrl: parsed.genesisUrl,
    genesisHash: parsed.genesisHash,
    genesisId: parsed.genesisId,
    genesisVersion: parsed.genesisVersion,
    githubOrg: parsed.githubOrg,
    orgName: parsed.orgName,
    skillsSource: parsed.skillsSource,
    skillsRef: parsed.skillsRef,
    minProbeVersion: parsed.minProbeVersion,
    promptMarkerTemplate: parsed.promptMarker,
    spacetime: {
      host: parsed.spacetimeHost,
      module: parsed.spacetimeModule,
    },
  });
}

export function agentCanApplyGenesis(agent: Agent | undefined): boolean {
  if (!agent) return false;
  const role = enumName(agent.role);
  return role === "Zoe" || role === "Admin";
}

export type AppliedGenesisRow = {
  genesisHash: string;
  skillsSource: string;
  skillsRef: string;
  minProbeVersion?: string;
  githubOrg: string;
};

export function computeSyncStatus(options: {
  localHash?: string;
  applied?: AppliedGenesisRow | null;
  localProbeVersion: string;
  localSkillsSource?: string;
  localSkillsRef?: string;
}): { status: AgentSyncStatus; syncError?: string } {
  const { localHash, applied, localProbeVersion, localSkillsSource, localSkillsRef } = options;

  if (applied?.minProbeVersion) {
    const cmp = compareSemver(localProbeVersion, applied.minProbeVersion);
    if (cmp !== null && cmp < 0) {
      return {
        status: { tag: "ProbeUpgradeRequired" },
        syncError: `Probe ${localProbeVersion} < minProbeVersion ${applied.minProbeVersion}`,
      };
    }
  }

  if (!applied) {
    return {
      status: { tag: "GenesisDrift" },
      syncError: "No applied genesis on Nexus",
    };
  }

  if (!localHash) {
    return {
      status: { tag: "GenesisDrift" },
      syncError: "Local genesis hash not set",
    };
  }

  if (localHash !== applied.genesisHash) {
    return {
      status: { tag: "GenesisDrift" },
      syncError: `Local hash ${localHash} != applied ${applied.genesisHash}`,
    };
  }

  if (
    localSkillsSource &&
    localSkillsRef &&
    (localSkillsSource !== applied.skillsSource || localSkillsRef !== applied.skillsRef)
  ) {
    const skills = checkSkillsCompatForGenesis(applied.skillsSource, applied.skillsRef);
    if (skills.status !== "ok") {
      return {
        status: { tag: "SkillsUpgradeRequired" },
        syncError: skills.message,
      };
    }
    return {
      status: { tag: "SkillsUpgradeRequired" },
      syncError: `Installed skills ${localSkillsSource}@${localSkillsRef} != applied ${applied.skillsSource}@${applied.skillsRef}`,
    };
  }

  const skillsCheck = checkSkillsCompatForGenesis(applied.skillsSource, applied.skillsRef);
  if (skillsCheck.status !== "ok") {
    return {
      status: { tag: "SkillsUpgradeRequired" },
      syncError: skillsCheck.message,
    };
  }

  return { status: { tag: "Synced" } };
}
