import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function nexusAuditRoot(): string {
  const override = process.env.PROBE_NEXUS_AUDIT_ROOT?.trim();
  return override ? resolve(override) : join(homedir(), ".probe", "audit", "nexus");
}

export function nexusAuditDirForWallet(wallet: string): string {
  return join(nexusAuditRoot(), wallet);
}

export function nexusAuditLogPath(wallet: string): string {
  return join(nexusAuditDirForWallet(wallet), "nexus.jsonl");
}
