import type { CommandContext } from "~/utils/context.js";
import { computeSyncStatus } from "~/utils/genesis-runtime.js";
import { probeVersion } from "~/probe-version.js";
import { reportRuntimeStatus, syncGenesis } from "~/utils/genesis-apply.js";
import { loadUserConfig } from "~/utils/user-config.js";
import type { EventEmitter } from "./events.js";
import { enumName } from "~/utils/enums.js";

export async function ensureGenesisSyncedBeforeHarness(
  ctx: CommandContext,
  emit: EventEmitter,
): Promise<boolean> {
  const local = await loadUserConfig();
  if (!("appliedGenesis" in ctx)) return true;

  const appliedRows = ctx.appliedGenesis ?? [];
  const appliedRow = appliedRows.find((r) => r.id === "active");
  const applied = appliedRow
    ? {
        genesisHash: appliedRow.genesisHash,
        skillsSource: appliedRow.skillsSource,
        skillsRef: appliedRow.skillsRef,
        minProbeVersion: appliedRow.minProbeVersion ?? undefined,
        githubOrg: appliedRow.githubOrg,
      }
    : null;

  let { status, syncError } = computeSyncStatus({
    localHash: local.genesisHash,
    applied,
    localProbeVersion: probeVersion(),
    localSkillsSource: local.skillsSource,
    localSkillsRef: local.skillsRef,
  });

  const tag = enumName(status);
  if (tag === "Synced") {
    await reportRuntimeStatus(ctx).catch(() => undefined);
    return true;
  }

  emit({
    type: "genesis_reconcile",
    sync_status: tag,
    sync_error: syncError ?? null,
  });

  if (tag === "ProbeUpgradeRequired") {
    await reportRuntimeStatus(ctx).catch(() => undefined);
    return false;
  }

  try {
    await syncGenesis(ctx, { installSkills: tag === "SkillsUpgradeRequired" });
    const afterStatus = await reportRuntimeStatus(ctx);
    if (afterStatus !== "Synced") {
      emit({
        type: "genesis_blocked",
        sync_status: afterStatus,
        sync_error: "Genesis sync did not reach Synced status",
      });
      return false;
    }
    return true;
  } catch (err) {
    emit({
      type: "genesis_blocked",
      sync_status: tag,
      sync_error: err instanceof Error ? err.message : String(err),
    });
    await reportRuntimeStatus(ctx).catch(() => undefined);
    return false;
  }
}
