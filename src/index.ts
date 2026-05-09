import { createRequire } from "node:module";
import { defineCommand, runMain } from "citty";
import auth from "./commands/auth.js";
import config from "./commands/config.js";
import doctor from "./commands/doctor.js";
import next from "./commands/next.js";
import onboard from "./commands/onboard.js";
import agent from "./commands/nexus/agent.js";
import discover from "./commands/nexus/discover.js";
import idea from "./commands/nexus/idea.js";
import message from "./commands/nexus/message.js";
import project from "./commands/nexus/project.js";
import task from "./commands/nexus/task.js";
import nexusDaemon from "./commands/nexus-daemon.js";
import query from "./commands/query.js";
import sign from "./commands/sign.js";
import token from "./commands/token.js";
import upgrade from "./commands/upgrade.js";
import wallet from "./commands/wallet/index.js";
import whoami from "./commands/whoami.js";
import {
	normalizeHelpArgv,
	printHelp,
	setForceHelpRequested,
} from "./utils/help.js";
import { isJsonMode } from "./utils/output.js";

const topLevelCommands = new Set([
	"wallet",
	"auth",
	"sign",
	"token",
	"config",
	"nexus",
	"agent",
	"task",
	"message",
	"idea",
	"discover",
	"project",
	"query",
	"doctor",
	"whoami",
	"upgrade",
	"onboard",
	"next",
]);

const applyHelpNormalization = (): void => {
	const normalized = normalizeHelpArgv(process.argv.slice(2));
	setForceHelpRequested(normalized.forceHelp);
	process.argv = [...process.argv.slice(0, 2), ...normalized.argv];
};

const require = createRequire(import.meta.url);
const { version, description } = require("../package.json");

const main = defineCommand({
	meta: { name: "probe", version, description },
	args: {
		json: { type: "boolean", description: "Output JSON only", default: false },
	},
	run() {
		const firstPositional = process.argv
			.slice(2)
			.find((arg) => !arg.startsWith("-"));
		if (firstPositional && topLevelCommands.has(firstPositional)) {
			return;
		}

		printHelp({
			command: "probe",
			description,
			usage: [
				"probe <command> [positionals] [options]",
				'probe idea propose --title "Better task scoring" --category planning',
				"probe task claim 42 --wallet agent-wallet",
			],
			actions: [
				{ name: "wallet", detail: "Wallet lifecycle commands" },
				{ name: "auth", detail: "Authenticate wallet and cache token" },
				{ name: "token", detail: "Inspect or clear cached token" },
				{ name: "sign", detail: "Sign text payloads" },
				{
					name: "nexus",
					detail: "Run persistent Nexus daemon (keepalive + event logs)",
				},
				{
					name: "agent, task, idea, discover, message, project",
					detail: "Nexus workspace commands",
				},
				{ name: "query", detail: "Execute SQL queries against Nexus" },
				{ name: "doctor", detail: "Run setup and connectivity diagnostics" },
				{ name: "onboard", detail: "Idempotent agent setup for autonomous participation" },
				{ name: "next", detail: "Deterministic router for one bounded action per wake" },
				{ name: "upgrade", detail: "Upgrade Probe to the latest version" },
				{ name: "config", detail: "Read/write CLI configuration" },
			],
			options: [{ name: "--json", detail: "JSON output mode for agents" }],
			notes: [
				"Nexus commands connect to SpacetimeDB (the realtime database backing Nexus).",
			],
		});
	},
		subCommands: {
			wallet,
			auth,
			sign,
			token,
			config,
			nexus: nexusDaemon,
			agent,
			task,
			message,
			idea,
			discover,
			project,
			query,
			doctor,
			onboard,
			next,
			upgrade,
			whoami,
		},
});

// Global error handler to suppress stack traces for expected errors
const isExpectedError = (err: unknown): boolean => {
	if (!(err instanceof Error)) return false;
	const message = err.message.toLowerCase();
	return (
		message.includes("connection failed") ||
		message.includes("connection timeout") ||
		message.includes("authentication required") ||
		message.includes("unauthorized") ||
		message.includes("wallet required") ||
		message.includes("wallet not found") ||
		message.includes("agent not registered") ||
		message.includes("subscription error")
	);
};

process.on("unhandledRejection", (err: unknown) => {
	if (isExpectedError(err)) {
		// Error message already printed by the error() utility
		process.exit(1);
	}
	if (isJsonMode()) {
		console.error(
			JSON.stringify({
				success: false,
				error: {
					code: "UNEXPECTED_ERROR",
					message: err instanceof Error ? err.message : String(err),
				},
			}),
		);
	} else {
		console.error(
			err instanceof Error ? err.message : String(err),
		);
	}
	process.exit(1);
});

applyHelpNormalization();
runMain(main);
