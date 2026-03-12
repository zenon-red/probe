import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "c12";
import { DEFAULT_CONFIG, type NexusConfig } from "~/types/index.js";
import { loadUserConfig } from "./user-config.js";

let cachedConfig: NexusConfig | null = null;

export async function getConfig(): Promise<NexusConfig> {
	if (cachedConfig) {
		return cachedConfig;
	}

	const [c12Config, userConfig] = await Promise.all([
		loadConfig<NexusConfig>({
			name: "probe",
			defaults: DEFAULT_CONFIG,
			envName: "PROBE",
		}),
		loadUserConfig(),
	]);

	cachedConfig = {
		...DEFAULT_CONFIG,
		...c12Config.config,
		...userConfig,
	};

	cachedConfig.walletDir = expandHomeDir(cachedConfig.walletDir);
	cachedConfig.tokenCacheDir = expandHomeDir(cachedConfig.tokenCacheDir);

	return cachedConfig;
}

export function clearConfigCache(): void {
	cachedConfig = null;
}

export function expandHomeDir(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

export async function getWalletDir(): Promise<string> {
	const config = await getConfig();
	return config.walletDir;
}

export async function getTokenCacheDir(): Promise<string> {
	const config = await getConfig();
	return config.tokenCacheDir;
}
