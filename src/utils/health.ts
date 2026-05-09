import { getConfig } from "~/utils/config.js";
import { CommandContext, type Agent } from "~/utils/context.js";
import { AgentRole } from "~/utils/enums.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { getWalletInfo } from "~/utils/wallet.js";

export type HealthStatus = "pass" | "warn" | "fail" | "manual_required";

export interface HealthCheck {
	check: string;
	status: HealthStatus;
	detail: string;
}

export interface HealthResult {
	ok: boolean;
	checks: HealthCheck[];
	counts: {
		pass: number;
		warn: number;
		fail: number;
		manual_required: number;
	};
	walletName?: string;
	walletAddress?: string;
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
	const checks: HealthCheck[] = [];
	const addCheck = (check: string, status: HealthStatus, detail: string) => {
		checks.push({ check, status, detail });
	};

	let config: Awaited<ReturnType<typeof getConfig>> | null = null;
	try {
		config = await getConfig();
		addCheck("config", "pass", "Loaded Probe configuration");
	} catch (err) {
		addCheck(
			"config",
			"fail",
			err instanceof Error ? err.message : "Failed to load configuration",
		);
	}

	const walletName = options.wallet || config?.defaultWallet;
	if (!walletName) {
		addCheck(
			"wallet.selected",
			"fail",
			"No wallet selected (set --wallet or defaultWallet)",
		);
	} else {
		addCheck("wallet.selected", "pass", `Using wallet '${walletName}'`);
	}

	let hasWallet = false;
	let walletAddress: string | undefined;
	if (walletName) {
		const wallet = await getWalletInfo(walletName);
		if (wallet) {
			hasWallet = true;
			walletAddress = wallet.address;
			addCheck("wallet.exists", "pass", `Address ${wallet.address}`);
		} else {
			addCheck("wallet.exists", "fail", `Wallet '${walletName}' not found`);
		}
	}

	let token: string | null = null;
	let tokenValid = false;
	let tokenExpiresAt: string | undefined;
	if (walletName && hasWallet) {
		const cached = await getCachedToken(walletName);
		if (!cached) {
			addCheck("auth.token", "fail", "No cached token (run probe auth)");
		} else {
			token = cached.token;
			const expires = new Date(cached.expiresAt);
			if (Number.isNaN(expires.getTime())) {
				addCheck("auth.token", "warn", "Token exists but expiry is invalid");
			} else if (expires.getTime() <= Date.now()) {
				addCheck(
					"auth.token",
					"fail",
					`Token expired at ${expires.toISOString()}`,
				);
			} else {
				tokenValid = true;
				tokenExpiresAt = cached.expiresAt;
				addCheck(
					"auth.token",
					"pass",
					`Token valid until ${expires.toISOString()}`,
				);
			}
		}
	}

	let identity: string | undefined;
	let agent: Agent | null = null;
	if (config && token) {
		const host = options.host || config.spacetime.host;
		const moduleName = options.module || config.spacetime.module;
		addCheck("nexus.target", "pass", `${host} / ${moduleName}`);

		if (tokenValid) {
			try {
				await using ctx = await CommandContext.create({
					host,
					module: moduleName,
					wallet: walletName,
					token,
					subscribe: options.includeAgent ?? false,
				});
				identity = ctx.identity?.toHexString() || "unknown";
				addCheck("nexus.connect", "pass", `Connected as ${identity}`);

				if (options.includeAgent && ctx.identity) {
					agent =
						ctx
							.iter<Agent>("agents")
							.find(
								(a) =>
									a.identity.toHexString() ===
									ctx.identity?.toHexString(),
							) || null;
					if (agent) {
						addCheck(
							"registration",
							"pass",
							`Agent ${agent.id} registered as ${AgentRole.display(agent.role)}`,
						);
					} else {
						addCheck(
							"registration",
							"fail",
							"Agent not registered",
						);
					}
				}
			} catch (err) {
				addCheck(
					"nexus.connect",
					"fail",
					err instanceof Error ? err.message : "Connection failed",
				);
			}
		} else {
			addCheck(
				"nexus.connect",
				"warn",
				"Skipped connection check (no valid token)",
			);
		}
	}

	const counts = checks.reduce(
		(acc, item) => {
			if (item.status === "pass") acc.pass += 1;
			else if (item.status === "warn") acc.warn += 1;
			else if (item.status === "fail") acc.fail += 1;
			else acc.manual_required += 1;
			return acc;
		},
		{ pass: 0, warn: 0, fail: 0, manual_required: 0 },
	);

	const criticalFail = checks.some(
		(c) =>
			c.status === "fail" &&
			["wallet.selected", "wallet.exists", "auth.token", "nexus.connect"].includes(
				c.check,
			),
	);

	return {
		ok: !criticalFail,
		checks,
		counts,
		walletName,
		walletAddress,
		tokenValid,
		tokenExpiresAt,
		identity,
		agent,
	};
}
