import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NexusConfig } from "~/types/index.js";

const CONFIG_PATH = join(homedir(), ".probe", "config.json");
const CONFIG_DIR = join(homedir(), ".probe");

export async function loadUserConfig(): Promise<Partial<NexusConfig>> {
	try {
		await access(CONFIG_PATH);
		const content = await readFile(CONFIG_PATH, "utf-8");
		return JSON.parse(content) as Partial<NexusConfig>;
	} catch {
		return {};
	}
}

export async function saveUserConfig(
	config: Partial<NexusConfig>,
): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), {
		mode: 0o600,
	});
}
