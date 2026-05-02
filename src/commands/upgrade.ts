import { defineCommand } from "citty";
import { confirm } from "@clack/prompts";
import { printHelp } from "~/utils/help.js";
import {
	error,
	info,
	isJsonMode,
	setJsonMode,
	success,
} from "~/utils/output.js";
import { toonList } from "~/utils/toon.js";
import {
	type InstallMethod,
	type InstallMethodArg,
	detectMethod,
	fetchGitHubReleaseByVersion,
	fetchLatestGitHubRelease,
	fetchLatestNpmVersion,
	getCurrentVersion,
	normalizeVersion,
	upgradeViaBinary,
	upgradeViaNpm,
} from "~/utils/upgrade.js";

const VALID_METHODS = new Set<InstallMethodArg>(["auto", "npm", "binary"]);

const printUpgradeResult = (data: {
	method: InstallMethod;
	currentVersion: string;
	targetVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
	updated: boolean;
	checkOnly: boolean;
}): void => {
	success(data);
	if (isJsonMode()) {
		return;
	}

	console.log(
		toonList("upgrade_result", [
			{
				method: data.method,
				currentVersion: data.currentVersion,
				targetVersion: data.targetVersion,
				latestVersion: data.latestVersion,
				updated: data.updated,
				checkOnly: data.checkOnly,
			},
		]),
	);
};

export default defineCommand({
	meta: {
		name: "upgrade",
		description: "Upgrade Probe to the latest or a specific version",
	},
	args: {
		target: {
			type: "positional",
			description: "Version to upgrade to (e.g. 1.2.0 or v1.2.0)",
			required: false,
		},
		check: {
			type: "boolean",
			description: "Check for updates without upgrading",
			default: false,
		},
		method: {
			type: "string",
			description: "Installation method: auto, npm, binary",
		},
		yes: {
			type: "boolean",
			description: "Skip confirmation prompts",
			default: false,
		},
		json: {
			type: "boolean",
			description: "Output JSON only",
			default: false,
		},
	},
	async run({ args }) {
		if (args.json) setJsonMode(true);

		if (args.target === "--help" || args.target === "-h") {
			printHelp({
				command: "probe upgrade",
				description: "Upgrade Probe to the latest or a specific version",
				usage: [
					"probe upgrade",
					"probe upgrade --check",
					"probe upgrade 1.2.0",
					"probe upgrade --method npm",
					"probe upgrade --method binary --yes",
					"probe upgrade --json --check",
				],
				options: [
					{
						name: "--check",
						detail: "Check for updates without upgrading",
					},
					{ name: "--method", detail: "Force install method: auto, npm, binary" },
					{ name: "--yes", detail: "Skip confirmation prompts" },
					{ name: "--json", detail: "JSON output for agents" },
				],
			});
			return;
		}

		const methodArg = args.method as InstallMethodArg | undefined;
		if (methodArg && !VALID_METHODS.has(methodArg)) {
			error(
				"INVALID_METHOD",
				`Invalid --method value: ${args.method}`,
				"Use: --method auto | npm | binary",
			);
		}

		const currentVersion = getCurrentVersion();
		const method = detectMethod(methodArg);

		// Resolve target version
		let targetVersion: string | undefined;
		let latestVersion: string | undefined;
		let targetRelease: Awaited<ReturnType<typeof fetchGitHubReleaseByVersion>> | undefined;

		try {
			if (args.target) {
				targetVersion = normalizeVersion(args.target);
				if (method === "binary") {
					targetRelease = await fetchGitHubReleaseByVersion(targetVersion);
				}
			} else if (method === "npm") {
				latestVersion = await fetchLatestNpmVersion();
				targetVersion = latestVersion;
			} else {
				const gh = await fetchLatestGitHubRelease();
				latestVersion = gh.version;
				targetVersion = gh.version;
				targetRelease = gh.release;
			}
		} catch (err) {
			error(
				"VERSION_LOOKUP_FAILED",
				err instanceof Error ? err.message : "Failed to check latest version",
			);
		}

		if (!targetVersion) {
			error("VERSION_LOOKUP_FAILED", "Could not determine target version.");
		}

		const updateAvailable = targetVersion !== currentVersion;

		// Check-only mode
		if (args.check) {
			printUpgradeResult({
				method,
				currentVersion,
				targetVersion: targetVersion,
				latestVersion: latestVersion || targetVersion,
				updateAvailable,
				updated: false,
				checkOnly: true,
			});
			return;
		}

		if (method === "unknown") {
			error(
				"METHOD_UNKNOWN",
				"Could not detect installation method for in-place upgrade.",
				"Use `probe upgrade --check --json` for agent-driven updates, or pass --method npm|binary explicitly.",
			);
		}

		if (!updateAvailable) {
			printUpgradeResult({
				method,
				currentVersion,
				targetVersion: targetVersion,
				latestVersion: latestVersion || targetVersion,
				updateAvailable: false,
				updated: false,
				checkOnly: false,
			});
			return;
		}

		if (!isJsonMode() && !args.yes) {
			const shouldUpgrade = await confirm({
				message: `Upgrade Probe from ${currentVersion} to ${targetVersion}?`,
			});
			if (!shouldUpgrade) {
				info("Upgrade cancelled");
				process.exit(0);
			}
		}

		// Perform upgrade
		try {
			if (method === "npm") {
				await upgradeViaNpm(targetVersion);
			} else {
				const release =
					targetRelease ||
					(await fetchGitHubReleaseByVersion(targetVersion));
				await upgradeViaBinary(release, targetVersion);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Upgrade failed";
			const code = message.includes("CHECKSUM_MISMATCH")
				? "CHECKSUM_MISMATCH"
				: message.includes("ROLLBACK_FAILED")
					? "ROLLBACK_FAILED"
					: message.includes("PERMISSION") || message.includes("EACCES")
						? "PERMISSION_DENIED"
						: "UPGRADE_FAILED";
			error(code, message);
		}

		printUpgradeResult({
			method,
			currentVersion,
			targetVersion: targetVersion,
			latestVersion: latestVersion || targetVersion,
			updateAvailable: true,
			updated: true,
			checkOnly: false,
		});
	},
});
