import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessType } from "~/types/config.js";
import type { EventEmitter } from "./events.js";
import { nexusAuditDirForWallet } from "./audit-paths.js";

export type ActionSidecarToolCall = {
  name: string;
  path?: string;
  diff?: string;
};

export type ActionSidecar = {
  actionId: string;
  harness: HarnessType;
  sessionFile?: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  toolCalls?: ActionSidecarToolCall[];
  tokens?: { in: number; out: number };
  cost?: number;
};

export function sidecarDirForWallet(wallet: string): string {
  return join(nexusAuditDirForWallet(wallet), "actions");
}

export function sidecarPathForAction(wallet: string, actionId: string): string {
  return join(sidecarDirForWallet(wallet), `${actionId}.json`);
}

export async function writeActionSidecar(
  wallet: string,
  sidecar: ActionSidecar,
  emit?: EventEmitter,
): Promise<void> {
  const path = sidecarPathForAction(wallet, sidecar.actionId);
  try {
    await mkdir(sidecarDirForWallet(wallet), { recursive: true });
    await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  } catch (err) {
    emit?.({
      type: "sidecar_write_failed",
      action_id: sidecar.actionId,
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
