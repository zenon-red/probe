import { execFileSync } from "node:child_process";
import type { CommandContext } from "~/utils/context.js";
import { callReducer } from "~/utils/context.js";
import {
  agentCanApplyGenesis,
  assertMinProbeVersion,
  computeSyncStatus,
  persistGenesisLocal,
  probeVersion,
  type AppliedGenesisRow,
} from "~/utils/genesis-runtime.js";
import {
  loadGenesisManifestFromSource,
  type ParsedGenesisManifest,
} from "~/utils/genesis-manifest.js";
import { skillsInstallArgs, skillsInstallCommand } from "~/utils/genesis-skills.js";
import { commandExists } from "~/utils/system.js";
import { SHELL_TIMEOUT } from "~/utils/timeouts.js";
import { enumName } from "~/utils/enums.js";

export type GenesisApplyResult = {
  parsed: ParsedGenesisManifest;
  genesisHash: string;
  persistedSource: string;
  pushedToNexus: boolean;
  syncStatus: string;
  skillsInstallCommand: string;
};

const GENESIS_SUBSCRIBE = [
  "SELECT * FROM agents",
  "SELECT * FROM applied_genesis",
  "SELECT * FROM agent_runtime_status",
];

function appliedFromCtx(ctx: CommandContext): AppliedGenesisRow | null {
  const rows = ctx.appliedGenesis ?? [];
  const active = rows.find((r) => r.id === "active") ?? rows[0];
  if (!active) return null;
  return {
    genesisHash: active.genesisHash,
    skillsSource: active.skillsSource,
    skillsRef: active.skillsRef,
    minProbeVersion: active.minProbeVersion ?? undefined,
    githubOrg: active.githubOrg,
  };
}

export async function validateGithubOrgExists(org: string, verify: boolean): Promise<void> {
  if (!verify) return;
  if (!commandExists("gh")) {
    throw new Error("gh CLI required for --verify org.githubOrg check");
  }
  try {
    execFileSync("gh", ["api", `orgs/${org}`, "--jq", ".login"], {
      stdio: "pipe",
      timeout: SHELL_TIMEOUT.MEDIUM,
    });
  } catch {
    throw new Error(`org.githubOrg '${org}' is not accessible via gh api orgs/${org}`);
  }
}

export async function reportRuntimeStatus(ctx: CommandContext): Promise<string> {
  const { loadUserConfig } = await import("~/utils/user-config.js");
  const local = await loadUserConfig();
  const applied = appliedFromCtx(ctx);
  const { status, syncError } = computeSyncStatus({
    localHash: local.genesisHash,
    applied,
    localProbeVersion: probeVersion(),
    localSkillsSource: local.skillsSource,
    localSkillsRef: local.skillsRef,
  });

  await callReducer(ctx, ctx.conn.reducers.reportAgentRuntimeStatus, {
    reportedGenesisHash: local.genesisHash ?? undefined,
    reportedProbeVersion: probeVersion(),
    reportedSkillsSource: local.skillsSource ?? undefined,
    reportedSkillsRef: local.skillsRef ?? undefined,
    syncStatus: status,
    syncError: syncError ?? undefined,
  });

  return enumName(status);
}

export async function persistGenesisFromSource(source: string): Promise<{
  parsed: ParsedGenesisManifest;
  persistedSource: string;
}> {
  const { parsed, persistedSource } = await loadGenesisManifestFromSource(source);
  assertMinProbeVersion(parsed.minProbeVersion);
  await persistGenesisLocal(parsed, persistedSource);
  return { parsed, persistedSource };
}

export async function applyGenesisFromSource(
  ctx: CommandContext,
  source: string,
  options: { verifyOrg?: boolean; pushToNexus?: boolean; installSkills?: boolean },
): Promise<GenesisApplyResult> {
  const { manifestJson, parsed, persistedSource } = await loadGenesisManifestFromSource(source);
  assertMinProbeVersion(parsed.minProbeVersion);
  await validateGithubOrgExists(parsed.githubOrg, !!options.verifyOrg);

  let pushedToNexus = false;
  const myAgent = ctx.agents.find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
  if (options.pushToNexus && agentCanApplyGenesis(myAgent)) {
    await callReducer(ctx, ctx.conn.reducers.applyGenesis, {
      manifestJson,
    });
    pushedToNexus = true;
  }

  await persistGenesisLocal(parsed, persistedSource);

  if (options.installSkills && commandExists("npx")) {
    try {
      execFileSync(
        "npx",
        skillsInstallArgs({ source: parsed.skillsSource, ref: parsed.skillsRef }),
        {
          stdio: "ignore",
          timeout: SHELL_TIMEOUT.VERY_LONG,
        },
      );
    } catch {
      // deferred install — doctor reports skills_upgrade_required
    }
  }

  const syncStatus = await reportRuntimeStatus(ctx);

  return {
    parsed,
    genesisHash: parsed.genesisHash,
    persistedSource,
    pushedToNexus,
    syncStatus,
    skillsInstallCommand: skillsInstallCommand(parsed.skillsSource, parsed.skillsRef),
  };
}

export async function syncGenesis(
  ctx: CommandContext,
  options: {
    source?: string;
    verifyOrg?: boolean;
    pushToNexus?: boolean;
    installSkills?: boolean;
  },
): Promise<GenesisApplyResult> {
  const { loadUserConfig } = await import("~/utils/user-config.js");
  const local = await loadUserConfig();
  let source = options.source ?? local.genesisSource;
  if (!source) {
    const row = ctx.appliedGenesis.find((r) => r.id === "active");
    source = row?.genesisUrl ?? undefined;
  }
  if (!source) {
    throw new Error("No genesis source: set genesis_source or pass a path/URL");
  }
  return applyGenesisFromSource(ctx, source, options);
}

export { GENESIS_SUBSCRIBE };
