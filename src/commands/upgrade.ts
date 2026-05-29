import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import { applyJsonMode, error } from "~/utils/output.js";
import { emitUpgradeFinish } from "~/utils/upgrade-skills-output.js";
import { loadUserConfig } from "~/utils/user-config.js";
import {
  type InstallMethodArg,
  detectMethod,
  fetchGitHubReleaseByVersion,
  fetchLatestGitHubRelease,
  fetchLatestNpmVersion,
  normalizeVersion,
  upgradeViaBinary,
  upgradeViaNpm,
} from "~/utils/upgrade.js";
import { probeVersion } from "~/probe-version.js";
import { errorMessage } from "~/utils/errors.js";

const VALID_METHODS = new Set<InstallMethodArg>(["auto", "npm", "binary"]);

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Upgrade Probe and sync genesis-pinned OpenSpec and skills",
  },
  args: {
    target: {
      type: "positional",
      description: "Version to upgrade to (e.g. 1.2.0 or v1.2.0)",
      required: false,
    },
    check: {
      type: "boolean",
      description: "Check probe and toolchain versions without upgrading",
      default: false,
    },
    method: {
      type: "string",
      description: "Installation method: auto, npm, binary",
    },
    yes: {
      type: "boolean",
      description: "Confirm upgrade and toolchain sync",
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
        description: "Upgrade Probe and sync genesis-pinned OpenSpec and skills",
        usage: [
          "probe upgrade",
          "probe upgrade --check",
          "probe upgrade --yes",
          "probe upgrade 1.2.0 --yes",
          "probe upgrade --method npm --yes",
          "probe upgrade --json --check",
        ],
        options: [
          { name: "--check", detail: "Report probe/openspec/skills vs genesis without changes" },
          { name: "--method", detail: "Force install method: auto, npm, binary" },
          { name: "--yes", detail: "Required — confirm probe upgrade and toolchain sync" },
          { name: "--json", detail: "JSON output" },
        ],
        notes: [
          "Syncs genesis toolchain (OpenSpec, skills) when configured; runs even if probe is already at target.",
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

    const currentVersion = probeVersion();
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
    const config = await loadUserConfig();
    const hasGenesis = Boolean(config.genesisHash || config.genesisSource);

    const finishUpgrade = async (updated: boolean, checkOnly: boolean, syncStack: boolean) => {
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
        { checkOnly, syncStack },
      );
    };

    if (args.check) {
      await finishUpgrade(false, true, false);
      return;
    }

    if (method === "unknown" && updateAvailable) {
      error(
        "METHOD_UNKNOWN",
        "Could not detect installation method for in-place upgrade.",
        "Use --method npm|binary explicitly, or run your package manager upgrade command (e.g. `bun add -g @zenon-red/probe`).",
      );
    }

    const needsMutation = updateAvailable || hasGenesis;

    if (!needsMutation) {
      await finishUpgrade(false, false, false);
      return;
    }

    if (!args.yes) {
      const targetArg = args.target ? ` ${args.target}` : "";
      const hint = updateAvailable
        ? `Upgrade from ${currentVersion} to ${targetVersion} requires --yes`
        : "Sync genesis toolchain (OpenSpec/skills) requires --yes";
      error("CONFIRMATION_REQUIRED", hint, `Run: probe upgrade${targetArg} --yes`);
    }

    let probeUpdated = false;
    if (updateAvailable) {
      if (method === "unknown") {
        error(
          "METHOD_UNKNOWN",
          "Could not detect installation method for in-place upgrade.",
          "Use --method npm|binary explicitly.",
        );
      }
      try {
        if (method === "npm") {
          await upgradeViaNpm(targetVersion);
        } else {
          const release = targetRelease || (await fetchGitHubReleaseByVersion(targetVersion));
          await upgradeViaBinary(release, targetVersion);
        }
        probeUpdated = true;
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
    }

    await finishUpgrade(probeUpdated, false, hasGenesis);
  },
});
