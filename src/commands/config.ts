import { defineCommand } from "citty";
import { clearConfigCache, getConfig } from "~/utils/config.js";
import { printHelp } from "~/utils/help.js";
import {
	error,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
} from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current && typeof current === "object" && part in current) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return current;
}

function setNestedValue(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	let current = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

export default defineCommand({
	meta: {
		name: "config",
		description: "Manage configuration settings",
	},
	args: {
		action: {
			type: "positional",
			description: "Action: get, set, list",
			required: false,
		},
		key: {
			type: "positional",
			description: "Configuration key",
			required: false,
		},
		value: {
			type: "positional",
			description: "Configuration value",
			required: false,
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

		if (!args.action) {
			printHelp({
				command: "probe config",
				description: "Read and write CLI configuration values",
				usage: [
					"probe config <action> [key] [value]",
					"probe config get spacetime.host",
					"probe config set defaultWallet agent-wallet",
				],
				actions: [
					{ name: "get <key>", detail: "Get one config value" },
					{ name: "set <key> <value>", detail: "Set one config value" },
					{ name: "list", detail: "List merged config and user overrides" },
				],
				notes: [
					"Valid keys: issuer, walletDir, defaultWallet, tokenCacheDir, requestTimeout, spacetime.host, spacetime.module.",
				],
			});
			return;
		}

		const action = args.action;
		const validKeys = [
			"issuer",
			"walletDir",
			"defaultWallet",
			"tokenCacheDir",
			"requestTimeout",
			"spacetime.host",
			"spacetime.module",
		];

		try {
			switch (action) {
				case "get": {
					if (!args.key) {
						error("KEY_REQUIRED", "Configuration key required");
					}

					if (!validKeys.includes(args.key)) {
						error(
							"INVALID_KEY",
							`Invalid configuration key: ${args.key}`,
							`Valid keys: ${validKeys.join(", ")}`,
						);
					}

					const config = await getConfig();
					const value = getNestedValue(
						config as unknown as Record<string, unknown>,
						args.key,
					);

					success({ [args.key]: value });

					if (!isJsonMode()) {
						console.log(`${args.key}: ${value}`);
					}
					break;
				}

				case "set": {
					if (!args.key || args.value === undefined) {
						error("ARGS_REQUIRED", "Configuration key and value required");
					}

					if (!validKeys.includes(args.key)) {
						error(
							"INVALID_KEY",
							`Invalid configuration key: ${args.key}`,
							`Valid keys: ${validKeys.join(", ")}`,
						);
					}

					let parsedValue: string | boolean | number = args.value;

					if (args.key === "requestTimeout") {
						parsedValue = parseInt(args.value, 10);
					}

					const userConfig = await loadUserConfig();
					setNestedValue(
						userConfig as unknown as Record<string, unknown>,
						args.key,
						parsedValue,
					);
					await saveUserConfig(userConfig);
					clearConfigCache();

					success({ [args.key]: parsedValue });

					if (!isJsonMode()) {
						successMessage(`Set ${args.key} = ${parsedValue}`);
					}
					break;
				}

				case "list": {
					const config = await getConfig();
					const userConfig = await loadUserConfig();

					success({
						...config,
						userConfig,
					});

					if (!isJsonMode()) {
						console.log("Configuration:");
						console.log(`  issuer: ${config.issuer}`);
						console.log(`  walletDir: ${config.walletDir}`);
						console.log(
							`  defaultWallet: ${config.defaultWallet || "(not set)"}`,
						);
						console.log(`  passwordMinLength: ${config.passwordMinLength}`);
						console.log(`  tokenCacheDir: ${config.tokenCacheDir}`);
						console.log(`  requestTimeout: ${config.requestTimeout}`);
						console.log(`  spacetime.host: ${config.spacetime.host}`);
						console.log(`  spacetime.module: ${config.spacetime.module}`);

						if (Object.keys(userConfig).length > 0) {
							console.log("\nUser overrides:");
							for (const [key, value] of Object.entries(userConfig)) {
								console.log(`  ${key}: ${JSON.stringify(value)}`);
							}
						}
					}
					break;
				}

				default:
					error(
						"INVALID_ACTION",
						`Invalid action: ${action}`,
						"Use: get, set, list",
					);
			}
		} catch (err) {
			error(
				"CONFIG_ERROR",
				err instanceof Error ? err.message : "Configuration error",
			);
		}
	},
});
