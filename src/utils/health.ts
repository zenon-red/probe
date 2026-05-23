import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "~/utils/config.js";
import { CommandContext, commandContextOptions, type Agent } from "~/utils/context.js";
import { countIssues, doctorOk, type DoctorIssue } from "~/utils/doctor-issues.js";
import { isPathWritable } from "~/utils/path-writable.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { getWalletInfo } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export interface HealthResult {
  ok: boolean;
  counts: { fail: number; warn: number };
  issues: DoctorIssue[];
  walletName?: string;
  walletAddress?: string;
  walletDir?: string;
  tokenCacheDir?: string;
  tokenValid?: boolean;
  tokenExpiresAt?: string;
  identity?: string;
  agent?: Agent | null;
}

export async function runHealthChecks(options: {
  wallet?: string;
  host?: string;
  module?: string;
  includeAgent?: boolean;
}): Promise<HealthResult> {
  const issues: DoctorIssue[] = [];
  const addIssue = (issue: DoctorIssue) => {
    issues.push(issue);
  };

  const probeHome = join(homedir(), ".probe");
  const probeHomeWritable = await isPathWritable(probeHome);
  if (!probeHomeWritable) {
    addIssue({
      code: "PROBE_HOME_NOT_WRITABLE",
      severity: "fail",
      message: `${probeHome} is not writable`,
      recommendation: "Ensure the Probe config directory exists and is writable",
    });
  }

  let config: Awaited<ReturnType<typeof getConfig>> | null = null;
  try {
    config = await getConfig();
  } catch (err) {
    addIssue({
      code: "CONFIG_LOAD_FAILED",
      severity: "fail",
      message: errorMessage(err, "Failed to load configuration"),
      recommendation: "Check ~/.probe/config.json and PROBE_* environment variables",
    });
  }

  let walletDirWritable = true;
  let tokenCacheWritable = true;
  if (config) {
    walletDirWritable = await isPathWritable(config.walletDir);
    if (!walletDirWritable) {
      addIssue({
        code: "WALLET_DIR_NOT_WRITABLE",
        severity: "fail",
        message: `${config.walletDir} is not writable`,
        recommendation: "Ensure the wallet directory exists and is writable",
      });
    }

    tokenCacheWritable = await isPathWritable(config.tokenCacheDir);
    if (!tokenCacheWritable) {
      addIssue({
        code: "TOKEN_CACHE_NOT_WRITABLE",
        severity: "fail",
        message: `${config.tokenCacheDir} is not writable`,
        recommendation: "Ensure the token cache directory exists and is writable",
      });
    }
  }

  if (!probeHomeWritable || !walletDirWritable || !tokenCacheWritable) {
    addIssue({
      code: "HOST_EXECUTION_UNTRUSTED",
      severity: "warn",
      message: "Probe home or data paths are not writable — execution may be sandboxed",
      recommendation: "Run outside a restricted sandbox or mount a writable home directory",
    });
  }

  const walletName = options.wallet || config?.defaultWallet;
  if (!walletName) {
    addIssue({
      code: "WALLET_NOT_SELECTED",
      severity: "fail",
      message: "No wallet selected (set --wallet or defaultWallet)",
      recommendation: "Create a wallet and set it as default",
      fix_command: "probe wallet create <name> --set-default --password-file <path>",
    });
  }

  let hasWallet = false;
  let walletAddress: string | undefined;
  if (walletName) {
    const wallet = await getWalletInfo(walletName);
    if (wallet) {
      hasWallet = true;
      walletAddress = wallet.address;
    } else {
      addIssue({
        code: "WALLET_NOT_FOUND",
        severity: "fail",
        message: `Wallet '${walletName}' not found`,
        recommendation: "Create or import the wallet, or pick an existing wallet",
        fix_command: `probe wallet create ${walletName} --password-file <path>`,
      });
    }
  }

  let token: string | null = null;
  let tokenValid = false;
  let tokenExpiresAt: string | undefined;
  if (walletName && hasWallet) {
    const cached = await getCachedToken(walletName);
    if (!cached) {
      addIssue({
        code: "AUTH_TOKEN_MISSING",
        severity: "fail",
        message: "No cached authentication token",
        recommendation: "Authenticate and save a token to the cache",
        fix_command: `probe login ${walletName} --password-file <path> --save`,
      });
    } else {
      token = cached.token;
      const expires = new Date(cached.expiresAt);
      if (Number.isNaN(expires.getTime())) {
        addIssue({
          code: "AUTH_TOKEN_INVALID_EXPIRY",
          severity: "warn",
          message: "Cached token has an invalid expiry timestamp",
          recommendation: "Clear the cached token and authenticate again",
          fix_command: `probe token ${walletName} --clear`,
        });
      } else if (expires.getTime() <= Date.now()) {
        addIssue({
          code: "AUTH_TOKEN_EXPIRED",
          severity: "fail",
          message: `Token expired at ${expires.toISOString()}`,
          recommendation: "Clear the expired token and authenticate again",
          fix_command: `probe token ${walletName} --clear`,
        });
      } else {
        tokenValid = true;
        tokenExpiresAt = cached.expiresAt;
      }
    }
  }

  let identity: string | undefined;
  let agent: Agent | null = null;
  const includeAgent = options.includeAgent !== false;

  if (config && token) {
    const host = options.host || config.spacetime.host;
    const moduleName = options.module || config.spacetime.module;

    if (tokenValid) {
      try {
        await using ctx = await CommandContext.create(
          commandContextOptions(
            { wallet: walletName, host: options.host, module: options.module },
            {
              token,
              subscribe: includeAgent ? ["SELECT * FROM agents", "SELECT * FROM config"] : [],
            },
          ),
        );
        identity = ctx.identity?.toHexString() || "unknown";

        if (includeAgent && ctx.identity) {
          agent =
            ctx.agents.find((a) => a.identity.toHexString() === ctx.identity?.toHexString()) ||
            null;
          if (!agent) {
            addIssue({
              code: "AGENT_NOT_REGISTERED",
              severity: "fail",
              message: "Agent identity is not registered in Nexus",
              recommendation: "Register the agent or run onboard",
              fix_command: "probe onboard --name <name> --password-file <path>",
            });
          }
        }
      } catch (err) {
        addIssue({
          code: "NEXUS_CONNECTION_FAILED",
          severity: "fail",
          message: errorMessage(err, "Connection failed"),
          recommendation: "Verify host, module, token, and network connectivity",
          fix_command: `probe doctor --host ${host} --module ${moduleName}`,
        });
      }
    } else {
      addIssue({
        code: "NEXUS_CONNECTION_SKIPPED",
        severity: "warn",
        message: "Skipped Nexus connection check (no valid token)",
        recommendation: "Authenticate before testing Nexus connectivity",
        fix_command: walletName
          ? `probe login ${walletName} --password-file <path> --save`
          : undefined,
      });
    }
  }

  return {
    ok: doctorOk(issues),
    counts: countIssues(issues),
    issues,
    walletName,
    walletAddress,
    walletDir: config?.walletDir,
    tokenCacheDir: config?.tokenCacheDir,
    tokenValid,
    tokenExpiresAt,
    identity,
    agent,
  };
}
