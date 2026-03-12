import { defineCommand } from "citty";
import { getConfig } from "~/utils/config.js";
import { CommandContext } from "~/utils/context.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { toonList } from "~/utils/toon.js";
import { getWalletInfo } from "~/utils/wallet.js";

type CheckStatus = "pass" | "warn" | "fail";

interface DoctorCheck {
	check: string;
	status: CheckStatus;
	detail: string;
}

export default defineCommand({
	meta: {
		name: "doctor",
		description: "Run environment and connectivity diagnostics",
	},
	args: {
		wallet: {
			type: "string",
			description: "Wallet name override for auth checks",
		},
		host: {
			type: "string",
			description: "SpacetimeDB host override",
		},
		module: {
			type: "string",
			description: "SpacetimeDB module override",
		},
		json: {
			type: "boolean",
			description: "Output JSON only",
			default: false,
		},
	},
	async run({ args }) {
		if (args.json) {
			setJsonMode(true);
		}

		if (forceHelpRequested()) {
			printHelp({
				command: "probe doctor",
				description: "Validate Probe config, auth, and Nexus connectivity",
				usage: [
					"probe doctor",
					"probe doctor --wallet my-wallet --host ws://127.0.0.1:3000 --module nexus",
				],
				options: [
					{ name: "--wallet", detail: "Wallet override for auth checks" },
					{ name: "--host, --module", detail: "SpacetimeDB overrides" },
					{ name: "--json", detail: "JSON output mode" },
				],
			});
			return;
		}

		const checks: DoctorCheck[] = [];
		const addCheck = (check: string, status: CheckStatus, detail: string) => {
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

		const walletName = args.wallet || config?.defaultWallet;
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
		if (walletName) {
			const wallet = await getWalletInfo(walletName);
			if (wallet) {
				hasWallet = true;
				addCheck("wallet.exists", "pass", `Address ${wallet.address}`);
			} else {
				addCheck("wallet.exists", "fail", `Wallet '${walletName}' not found`);
			}
		}

		let token: string | null = null;
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
					addCheck(
						"auth.token",
						"pass",
						`Token valid until ${expires.toISOString()}`,
					);
				}
			}
		}

		if (config) {
			const host = args.host || config.spacetime.host;
			const moduleName = args.module || config.spacetime.module;
			addCheck("nexus.target", "pass", `${host} / ${moduleName}`);

			if (token) {
				try {
					await using ctx = await CommandContext.create({
						host,
						module: moduleName,
						wallet: walletName,
						token,
						subscribe: false,
					});
					const identity = ctx.identity?.toHexString() || "unknown";
					addCheck("nexus.connect", "pass", `Connected as ${identity}`);
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
				else acc.fail += 1;
				return acc;
			},
			{ pass: 0, warn: 0, fail: 0 },
		);

		const ok = counts.fail === 0;
		success({ ok, counts, checks });

		if (!isJsonMode()) {
			console.log(toonList("doctor_checks", checks));
			console.log(toonList("doctor_summary", [{ ok, ...counts }]));
		}
	},
});
