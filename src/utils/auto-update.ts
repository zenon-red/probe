import { getConfig } from "~/utils/config.js";
import { isJsonMode } from "~/utils/output-mode.js";
import {
  type InstallMethod,
  detectMethod,
  fetchLatestGitHubRelease,
  fetchLatestNpmVersion,
  getCurrentVersion,
  upgradeViaBinary,
  upgradeViaNpm,
} from "~/utils/upgrade.js";

let lastNotifiedVersion = "";

function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const maxLen = Math.max(av.length, bv.length);
  for (let i = 0; i < maxLen; i++) {
    const ai = av[i] || 0;
    const bi = bv[i] || 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

async function getLatestVersionByMethod(method: InstallMethod): Promise<string> {
  if (method === "binary") {
    const gh = await fetchLatestGitHubRelease();
    return gh.version;
  }
  return fetchLatestNpmVersion();
}

async function performAutoUpgrade(method: InstallMethod, targetVersion: string): Promise<void> {
  if (method === "npm") {
    await upgradeViaNpm(targetVersion);
    return;
  }
  if (method === "binary") {
    const gh = await fetchLatestGitHubRelease();
    await upgradeViaBinary(gh.release, targetVersion);
  }
}

export async function checkAutoUpdate(): Promise<void> {
  const config = await getConfig();
  const autoUpdate = config.autoUpdate ?? "notify";
  if (autoUpdate === false) return;

  const method = detectMethod();
  if (method === "unknown") return;

  let latest = "";
  try {
    latest = await getLatestVersionByMethod(method);
  } catch {
    return;
  }

  const current = getCurrentVersion();
  const hasUpdate = compareSemver(latest, current) > 0;

  if (!hasUpdate) {
    lastNotifiedVersion = "";
    return;
  }

  if (autoUpdate === "notify") {
    if (lastNotifiedVersion !== latest && !isJsonMode()) {
      console.error(
        `UPDATE_AVAILABLE: probe ${current} -> ${latest}. Run \`probe upgrade --yes\` to update.`,
      );
      lastNotifiedVersion = latest;
    }
    return;
  }

  try {
    await performAutoUpgrade(method, latest);
    if (!isJsonMode()) {
      console.error(`AUTO_UPDATE: Probe auto-updated to ${latest}`);
    }
    lastNotifiedVersion = "";
  } catch {
    if (!isJsonMode()) {
      console.error("AUTO_UPDATE_FAILED: Run `probe upgrade --yes` manually.");
    }
  }
}

export function checkAutoUpdateInBackground(): void {
  void checkAutoUpdate();
}
