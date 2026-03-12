import { defineCommand } from "citty";
import { printHelp } from "~/utils/help.js";
import {
	error,
	info,
	isJsonMode,
	setJsonMode,
	success,
} from "~/utils/output.js";
import { clearCachedToken, getCachedToken } from "~/utils/token-cache.js";

export default defineCommand({
	meta: {
		name: "token",
		description: "Show cached JWT token for wallet",
	},
	args: {
		name: {
			type: "positional",
			description: "Wallet name",
			required: false,
		},
		clear: {
			type: "boolean",
			description: "Clear cached token now (next auth call gets a new token)",
			default: false,
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

		const name = args.name;

		if (!name) {
			printHelp({
				command: "probe token",
				description: "Inspect or clear cached authentication token",
				usage: [
					"probe token <wallet-name> [options]",
					"probe token <wallet-name> --clear",
				],
				options: [
					{ name: "--clear", detail: "Clear cached token now (recommended)" },
					{ name: "--json", detail: "JSON output for agents" },
				],
			});
			return;
		}

		if (args.clear) {
			await clearCachedToken(name);

			success({ cleared: name });

			if (!isJsonMode()) {
				info(
					`Token cache cleared for "${name}". Run 'probe auth' to get a new token.`,
				);
			}
			return;
		}

		try {
			const cached = await getCachedToken(name);

			if (!cached) {
				error(
					"TOKEN_NOT_FOUND",
					`No cached token for wallet '${name}'`,
					`Run 'probe auth ${name} --save' to authenticate`,
				);
			}

			const expiresAt = new Date(cached.expiresAt);
			const now = new Date();
			const expiresIn = Math.floor(
				(expiresAt.getTime() - now.getTime()) / 1000,
			);
			const valid = expiresIn > 0;

			success({
				wallet: name,
				token: cached.token,
				expiresAt: cached.expiresAt,
				expiresIn: Math.max(0, expiresIn),
				valid,
			});

			if (!isJsonMode()) {
				console.log(`Wallet: ${name}`);
				console.log(`Token: ${cached.token.slice(0, 50)}...`);
				console.log(`Expires: ${expiresAt.toUTCString()}`);
				console.log(`Status: ${valid ? "Valid" : "Expired"}`);

				if (!valid) {
					info(
						"Token has expired. Run with --clear to remove it and re-authenticate.",
					);
				}
			}
		} catch (err) {
			error(
				"TOKEN_ERROR",
				err instanceof Error ? err.message : "Failed to read token",
			);
		}
	},
});
