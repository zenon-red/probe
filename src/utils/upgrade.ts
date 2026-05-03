import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createWriteStream,
	existsSync,
	readFileSync,
	renameSync,
	unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

export type InstallMethod = "npm" | "binary" | "unknown";
export type InstallMethodArg = "auto" | "npm" | "binary";

const PACKAGE = "@zenon-red/probe";
const REPO = "zenon-red/probe";
const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT = 30_000;

const require = createRequire(import.meta.url);

export function normalizeVersion(input: string): string {
	const trimmed = input.trim();
	if (trimmed.startsWith(`${PACKAGE}@`)) {
		return trimmed.slice(`${PACKAGE}@`.length);
	}
	if (trimmed.startsWith("refs/tags/")) {
		return normalizeVersion(trimmed.slice("refs/tags/".length));
	}
	return trimmed.replace(/^v/, "");
}

export function getCurrentVersion(): string {
	const candidates = [
		"../../package.json",
		"../package.json",
		"../../../package.json",
	];
	try {
		for (const candidate of candidates) {
			try {
				const version = require(candidate).version as string;
				if (version) return version;
			} catch {
				// try next candidate
			}
		}
		if (process.env.npm_package_version) {
			return process.env.npm_package_version;
		}
	} catch {
		// fallthrough
	}
	return "0.0.0";
}

export function detectMethod(explicit?: InstallMethodArg): InstallMethod {
	if (explicit && explicit !== "auto") return explicit;

	const execPath = process.execPath;
	const argv1 = process.argv[1] || "";
	let resolvedProbePath = "";

	try {
		resolvedProbePath = execSync("command -v probe", {
			timeout: 5_000,
			encoding: "utf8",
		}).trim();
	} catch {
		// ignore lookup failures
	}

	// Standalone binary heuristics
	if (
		execPath.includes(".probe") ||
		execPath.includes("probe-linux") ||
		execPath.includes("probe-darwin") ||
		execPath.includes("probe-windows") ||
		argv1.includes(".probe") ||
		resolvedProbePath.includes(".probe") ||
		resolvedProbePath.includes("probe-linux") ||
		resolvedProbePath.includes("probe-darwin") ||
		resolvedProbePath.includes("probe-windows")
	) {
		return "binary";
	}

	// npm global install heuristic
	if (
		argv1.includes("node_modules") ||
		resolvedProbePath.includes("node_modules")
	)
		return "npm";

	// Try npm list (only if npm exists)
	try {
		const out = execSync("npm list -g @zenon-red/probe --depth=0 2>/dev/null", {
			timeout: 10_000,
			encoding: "utf8",
		});
		if (out.includes("@zenon-red/probe")) return "npm";
	} catch {
		// npm not found or not installed globally
	}

	return "unknown";
}

export async function fetchLatestNpmVersion(): Promise<string> {
	const url = `${NPM_REGISTRY}/${PACKAGE}/latest`;
	const res = await fetch(url, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});
	if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
	const data = (await res.json()) as { version?: string };
	if (!data.version) throw new Error("No version field in npm response");
	return normalizeVersion(data.version);
}

export interface GitHubRelease {
	tag_name: string;
	assets: Array<{ name: string; browser_download_url: string }>;
}

async function fetchGitHubRelease(path: string): Promise<GitHubRelease> {
	const url = `${GITHUB_API}/repos/${REPO}/releases/${path}`;
	const res = await fetch(url, {
		headers: { Accept: "application/vnd.github+json" },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});
	if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
	return (await res.json()) as GitHubRelease;
}

export async function fetchLatestGitHubRelease(): Promise<{
	version: string;
	release: GitHubRelease;
}> {
	const release = await fetchGitHubRelease("latest");
	const version = normalizeVersion(release.tag_name);
	return { version, release };
}

export async function fetchGitHubReleaseByVersion(
	version: string,
): Promise<GitHubRelease> {
	const normalized = normalizeVersion(version);
	try {
		return await fetchGitHubRelease(`tags/v${normalized}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : "";
		if (!message.includes("404")) {
			throw err;
		}
		const packageTag = encodeURIComponent(`${PACKAGE}@${normalized}`);
		return await fetchGitHubRelease(`tags/${packageTag}`);
	}
}

export function resolveBinaryAssetName(): string {
	const p = platform();
	const a = arch();

	const platformMap: Record<string, string> = {
		linux: "linux",
		darwin: "darwin",
		windows: "windows",
	};
	const archMap: Record<string, string> = {
		x64: "x64",
		arm64: "arm64",
	};

	const plat = platformMap[p];
	const cpuArch = archMap[a];
	if (!plat || !cpuArch) {
		throw new Error(`Unsupported platform: ${p}/${cpuArch}`);
	}

	const ext = (platform() as string) === "windows" ? ".exe" : "";
	return `probe-${plat}-${cpuArch}${ext}`;
}

export function getBinaryDir(): string {
	return dirname(process.execPath);
}

export async function downloadFile(url: string, dest: string): Promise<void> {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT * 2),
		redirect: "follow",
	});
	if (!res.ok)
		throw new Error(`Download failed: ${res.status} ${res.statusText}`);
	if (!res.body) throw new Error("Empty response body");

	const nodeStream = Readable.fromWeb(
		res.body as unknown as import("node:stream/web").ReadableStream,
	);
	const ws = createWriteStream(dest, { mode: 0o755 });
	await finished(nodeStream.pipe(ws));
}

export function verifyChecksum(filePath: string, checksums: string): boolean {
	const fileName =
		filePath.split("/").pop() || filePath.split("\\").pop() || "";
	const lines = checksums.split("\n");
	let expected = "";
	for (const line of lines) {
		const [hash, name] = line.trim().split(/\s+/);
		if (name === fileName) {
			expected = hash;
			break;
		}
	}
	if (!expected) return false;

	const data = readFileSync(filePath);
	const actual = createHash("sha256").update(data).digest("hex");
	return actual === expected;
}

export async function upgradeViaNpm(target: string): Promise<void> {
	const version = normalizeVersion(target);
	execSync(`npm install -g ${PACKAGE}@${version}`, {
		stdio: "inherit",
		timeout: 120_000,
	});
}

export async function upgradeViaBinary(
	release: GitHubRelease,
	_target: string,
): Promise<void> {
	const assetName = resolveBinaryAssetName();
	const asset = release.assets.find((a) => a.name === assetName);
	if (!asset) throw new Error(`Asset not found for ${assetName}`);

	const checksumAsset = release.assets.find(
		(a) => a.name === "SHA256SUMS.txt",
	);
	if (!checksumAsset) throw new Error("SHA256SUMS.txt not found in release");

	const binDir = getBinaryDir();
	const targetPath = resolve(
		binDir,
		(platform() as string) === "windows" ? "probe.exe" : "probe",
	);
	const tmpPath = `${targetPath}.tmp`;
	const backupPath = `${targetPath}.bak`;

	// Download binary + checksum
	await downloadFile(asset.browser_download_url, tmpPath);

	const checksumRes = await fetch(checksumAsset.browser_download_url, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});
	if (!checksumRes.ok) throw new Error("Failed to download SHA256SUMS.txt");
	const checksums = await checksumRes.text();

	// Verify checksum
	if (!verifyChecksum(tmpPath, checksums)) {
		unlinkSync(tmpPath);
		throw new Error("CHECKSUM_MISMATCH");
	}

	// Atomic replace with rollback
	try {
		if (existsSync(targetPath)) {
			renameSync(targetPath, backupPath);
		}
		renameSync(tmpPath, targetPath);
		// Post-upgrade smoke test
		execSync(`"${targetPath}" --version`, {
			timeout: 10_000,
			encoding: "utf8",
		});
		// Cleanup backup on success
		if (existsSync(backupPath)) {
			try {
				unlinkSync(backupPath);
			} catch {
				// non-fatal
			}
		}
	} catch (err) {
		// Rollback
		if (existsSync(backupPath)) {
			try {
				renameSync(backupPath, targetPath);
			} catch {
				throw new Error(
					`ROLLBACK_FAILED: Upgrade failed and rollback also failed. Backup at: ${backupPath}`,
				);
			}
		}
		if (existsSync(tmpPath)) {
			try {
				unlinkSync(tmpPath);
			} catch {
				// non-fatal
			}
		}
		throw err;
	}
}
