import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTokenCacheDir } from "./config.js";

export async function cacheToken(
	wallet: string,
	token: string,
	expiresAt: string,
): Promise<void> {
	const cacheDir = await getTokenCacheDir();

	try {
		await mkdir(cacheDir, { recursive: true });
	} catch {}

	const cachePath = join(cacheDir, `${wallet}.jwt`);
	const data = {
		token,
		expiresAt,
	};

	await writeFile(cachePath, JSON.stringify(data), { mode: 0o600 });
}

export async function getCachedToken(
	wallet: string,
): Promise<{ token: string; expiresAt: string } | null> {
	const cacheDir = await getTokenCacheDir();
	const cachePath = join(cacheDir, `${wallet}.jwt`);

	try {
		await access(cachePath);
		const content = await readFile(cachePath, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

export async function clearCachedToken(wallet: string): Promise<void> {
	const cacheDir = await getTokenCacheDir();
	const cachePath = join(cacheDir, `${wallet}.jwt`);

	try {
		await access(cachePath);
		const { unlink } = await import("node:fs/promises");
		await unlink(cachePath);
	} catch {}
}
