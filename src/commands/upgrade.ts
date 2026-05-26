import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import { applyJsonMode, error } from "~/utils/output.js";
import { emitUpgradeFinish } from "~/utils/upgrade-skills-output.js";
import {
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
import { errorMessage } from "~/utils/errors.js";

const VALID_METHODS = new Set<InstallMethodArg>(["auto", "npm", "binary"]);

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
      description: "Confirm upgrade (required when upgrade would proceed)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

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
          { name: "--yes", detail: "Required — confirm upgrade (no interactive prompt)" },
          { name: "--json", detail: "JSON output" },
        ],
        notes: ["Interactive confirmation is not supported. Pass --yes to upgrade."],
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
      const message = errorMessage(err, "Failed to check latest version");
      if (!args.target && method === "binary" && message.includes("GitHub API returned 404")) {
        error(
          "NO_RELEASES_PUBLISHED",
          "No GitHub releases are published yet for binary upgrades.",
          "Use: npm install -g @zenon-red/probe (or your package manager) until the first release is published.",
        );
      }
      error("VERSION_LOOKUP_FAILED", message);
    }

    if (!targetVersion) {
      error("VERSION_LOOKUP_FAILED", "Could not determine target version.");
    }

    const updateAvailable = targetVersion !== currentVersion;

    const finishUpgrade = async (updated: boolean, checkOnly: boolean) => {
      await emitUpgradeFinish(
        {
          method,
          currentVersion,
          targetVersion,
          latestVersion: latestVersion || targetVersion,
          updateAvailable,
          updated,
          checkOnly,
        },
        updated,
      );
    };

    if (args.check) {
      await finishUpgrade(false, true);
      return;
    }

    if (method === "unknown") {
      error(
        "METHOD_UNKNOWN",
        "Could not detect installation method for in-place upgrade.",
        "Use --method npm|binary explicitly, or run your package manager upgrade command (e.g. `bun add -g @zenon-red/probe`).",
      );
    }

    if (!updateAvailable) {
      await finishUpgrade(false, false);
      return;
    }

    if (!args.yes) {
      const targetArg = args.target ? ` ${args.target}` : "";
      error(
        "CONFIRMATION_REQUIRED",
        `Upgrade from ${currentVersion} to ${targetVersion} requires --yes`,
        `Run: probe upgrade${targetArg} --yes`,
      );
    }

    try {
      if (method === "npm") {
        await upgradeViaNpm(targetVersion);
      } else {
        const release = targetRelease || (await fetchGitHubReleaseByVersion(targetVersion));
        await upgradeViaBinary(release, targetVersion);
      }
    } catch (err) {
      const message = errorMessage(err, "Upgrade failed");
      const code = message.includes("CHECKSUM_MISMATCH")
        ? "CHECKSUM_MISMATCH"
        : message.includes("ROLLBACK_FAILED")
          ? "ROLLBACK_FAILED"
          : message.includes("PERMISSION") || message.includes("EACCES")
            ? "PERMISSION_DENIED"
            : "UPGRADE_FAILED";
      error(code, message);
    }

    await finishUpgrade(true, false);
  },
});
