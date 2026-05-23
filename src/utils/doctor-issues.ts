import { homedir } from "node:os";
import { join } from "node:path";
import { clearCachedToken } from "~/utils/token-cache.js";
import { listWallets } from "~/utils/wallet.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { ensurePathWritable } from "~/utils/path-writable.js";

export type IssueSeverity = "fail" | "warn";

export interface DoctorIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  recommendation?: string;
  fix_command?: string;
}

export interface DoctorCounts {
  fail: number;
  warn: number;
}

export function countIssues(issues: DoctorIssue[]): DoctorCounts {
  return issues.reduce(
    (acc, issue) => {
      if (issue.severity === "fail") acc.fail += 1;
      else acc.warn += 1;
      return acc;
    },
    { fail: 0, warn: 0 },
  );
}

export function doctorOk(issues: DoctorIssue[]): boolean {
  return !issues.some((issue) => issue.severity === "fail");
}

export function buildDoctorNextCommands(
  issues: DoctorIssue[],
  walletName: string | undefined,
): string[] | undefined {
  if (doctorOk(issues)) return undefined;

  const codes = new Set(issues.map((issue) => issue.code));
  const commands: string[] = [];

  for (const issue of issues) {
    if (issue.fix_command && !commands.includes(issue.fix_command)) {
      commands.push(issue.fix_command);
    }
  }

  if (codes.has("AUTH_TOKEN_MISSING") || codes.has("AUTH_TOKEN_EXPIRED")) {
    if (walletName) {
      commands.push(`probe login ${walletName} --password-file <path> --save`);
    }
  }
  if (codes.has("WALLET_NOT_SELECTED") || codes.has("WALLET_NOT_FOUND")) {
    commands.push("probe wallet create <name> --set-default --password-file <path>");
  }
  if (codes.has("AGENT_NOT_REGISTERED")) {
    commands.push("probe agent register <agent-id> <name> --wallet <wallet>");
  }
  if (codes.has("NEXUS_CONNECTION_FAILED")) {
    commands.push("probe doctor --host <host> --module nexus");
  }

  return commands.length > 0 ? commands : ["probe --help"];
}

export interface DoctorFixResult {
  code: string;
  action: string;
}

const FIXABLE_CODES = new Set([
  "PROBE_HOME_NOT_WRITABLE",
  "WALLET_DIR_NOT_WRITABLE",
  "TOKEN_CACHE_NOT_WRITABLE",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_TOKEN_INVALID_EXPIRY",
  "WALLET_NOT_SELECTED",
]);

export async function applyDoctorFixes(
  issues: DoctorIssue[],
  context: {
    walletName?: string;
    walletDir?: string;
    tokenCacheDir?: string;
  },
): Promise<DoctorFixResult[]> {
  const fixed: DoctorFixResult[] = [];
  const codes = new Set(issues.map((issue) => issue.code));

  if (codes.has("PROBE_HOME_NOT_WRITABLE")) {
    const probeHome = join(homedir(), ".probe");
    if (await ensurePathWritable(probeHome)) {
      fixed.push({ code: "PROBE_HOME_NOT_WRITABLE", action: `Created writable ${probeHome}` });
    }
  }

  if (codes.has("WALLET_DIR_NOT_WRITABLE") && context.walletDir) {
    if (await ensurePathWritable(context.walletDir)) {
      fixed.push({
        code: "WALLET_DIR_NOT_WRITABLE",
        action: `Created writable ${context.walletDir}`,
      });
    }
  }

  if (codes.has("TOKEN_CACHE_NOT_WRITABLE") && context.tokenCacheDir) {
    if (await ensurePathWritable(context.tokenCacheDir)) {
      fixed.push({
        code: "TOKEN_CACHE_NOT_WRITABLE",
        action: `Created writable ${context.tokenCacheDir}`,
      });
    }
  }

  if (
    (codes.has("AUTH_TOKEN_EXPIRED") || codes.has("AUTH_TOKEN_INVALID_EXPIRY")) &&
    context.walletName
  ) {
    await clearCachedToken(context.walletName);
    fixed.push({
      code: codes.has("AUTH_TOKEN_EXPIRED") ? "AUTH_TOKEN_EXPIRED" : "AUTH_TOKEN_INVALID_EXPIRY",
      action: `Cleared cached token for ${context.walletName}`,
    });
  }

  if (codes.has("WALLET_NOT_SELECTED")) {
    const wallets = await listWallets();
    if (wallets.length === 1) {
      const onlyWallet = wallets[0].name;
      const userConfig = await loadUserConfig();
      if (userConfig.defaultWallet !== onlyWallet) {
        await saveUserConfig({ ...userConfig, defaultWallet: onlyWallet });
        fixed.push({
          code: "WALLET_NOT_SELECTED",
          action: `Set default wallet to ${onlyWallet}`,
        });
      }
    }
  }

  return fixed.filter((item) => FIXABLE_CODES.has(item.code));
}
