import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineCommand } from "citty";
import { createConsola } from "consola";
import { type Agent, callReducer, withAuth } from "~/utils/context.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_JITTER_MS = 5_000;
const HEARTBEAT_FAILURE_THRESHOLD = 3;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const OBSERVED_TABLES = [
	{ key: "agents", name: "agents" },
	{ key: "tasks", name: "tasks" },
	{ key: "ideas", name: "ideas" },
	{ key: "messages", name: "messages" },
	{ key: "channels", name: "channels" },
	{ key: "projects", name: "projects" },
	{ key: "votes", name: "votes" },
	{ key: "discovered_tasks", name: "discovered_tasks" },
	{ key: "task_dependencies", name: "task_dependencies" },
	{ key: "identity_roles", name: "identity_roles" },
	{ key: "config", name: "config" },
	{ key: "project_channels", name: "project_channels" },
	{ key: "project_messages", name: "project_messages" },
] as const;

type DaemonEvent = {
	type: string;
	source: "nexus";
	at: string;
	[key: string]: unknown;
};

type SessionEnd = {
	reason: "disconnected" | "heartbeat_failed" | "stop";
	details?: unknown;
};

type LogLevel = "critical" | "info" | "debug";

type ObservableTable = {
	onInsert?: (cb: (_ctx: unknown, row: unknown) => void) => void;
	onUpdate?: (
		cb: (_ctx: unknown, oldRow: unknown, newRow: unknown) => void,
	) => void;
	onDelete?: (cb: (_ctx: unknown, row: unknown) => void) => void;
};

const CRITICAL_EVENTS = new Set([
	"connected",
	"ready",
	"disconnected",
	"reconnecting",
	"reconnected",
	"subscription_applied",
	"subscription_error",
	"auth_failed",
	"heartbeat_failed",
	"heartbeat_recovered",
	"shutdown",
]);

const jsonReplacer = (_key: string, value: unknown): unknown => {
	if (typeof value === "bigint") {
		return value.toString();
	}
	return value;
};

const nowIso = (): string => new Date().toISOString();

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const withJitter = (baseMs: number): number => {
	const jitter = Math.floor(
		Math.random() * (HEARTBEAT_JITTER_MS * 2 + 1) - HEARTBEAT_JITTER_MS,
	);
	return Math.max(1_000, baseMs + jitter);
};

const backoffMs = (attempt: number): number => {
	const base = Math.min(
		RECONNECT_MAX_MS,
		RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1),
	);
	return withJitter(base);
};

const normalizeError = (err: unknown): string => {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
};

const sanitizeValue = (value: unknown): unknown => {
	if (value instanceof Error) {
		return { name: value.name, message: value.message };
	}
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	try {
		return JSON.parse(JSON.stringify(value, jsonReplacer));
	} catch {
		return String(value);
	}
};

const resolveLogLevel = (value: unknown): LogLevel => {
	if (value === "critical" || value === "info" || value === "debug") {
		return value;
	}
	return "critical";
};

const shouldEmit = (eventType: string, level: LogLevel): boolean => {
	if (level === "debug") {
		return true;
	}
	if (CRITICAL_EVENTS.has(eventType)) {
		return true;
	}
	if (level === "info" && eventType.startsWith("heartbeat_")) {
		return true;
	}
	return false;
};

const resolveLogStream = async (
	pathValue?: string,
): Promise<WriteStream | null> => {
	if (!pathValue) {
		return null;
	}
	const absolutePath = resolve(pathValue);
	await mkdir(dirname(absolutePath), { recursive: true });
	return createWriteStream(absolutePath, { flags: "a" });
};

const connectErrorLooksAuthRelated = (message: string): boolean => {
	const lowered = message.toLowerCase();
	return (
		lowered.includes("authentication required") ||
		lowered.includes("unauthorized") ||
		lowered.includes("401")
	);
};

export const nexusDaemonArgs = {
	wallet: {
		type: "string",
		description: "Wallet name for authenticated connection",
	},
	host: {
		type: "string",
		description: "SpacetimeDB host override",
	},
	module: {
		type: "string",
		description: "SpacetimeDB module override",
	},
	sender: {
		type: "string",
		description: "Optional sender filter (debug table events only)",
	},
	"log-file": {
		type: "string",
		description: "Optional path to append JSONL daemon events",
	},
	"log-level": {
		type: "string",
		description: "critical, info, or debug",
		default: "critical",
	},
	pretty: {
		type: "boolean",
		description: "Human-readable lifecycle logs to stderr",
		default: false,
	},
	json: {
		type: "boolean",
		description: "Reserved for CLI consistency",
		default: false,
	},
} as const;

export async function runNexusDaemon(
	args: Record<string, unknown>,
): Promise<void> {
	const logLevel = resolveLogLevel(args["log-level"]);
	const pretty = !!args.pretty;
	const prettyLogger = pretty
		? createConsola({
				stdout: process.stderr,
				stderr: process.stderr,
			})
		: null;

	let logStream: WriteStream | null = null;
	try {
		logStream = await resolveLogStream(args["log-file"]);
	} catch (err) {
		const message = normalizeError(err);
		const fallback = JSON.stringify({
			source: "nexus",
			at: nowIso(),
			type: "log_file_error",
			message,
		});
		console.log(fallback);
		return;
	}

	const writeEvent = (event: DaemonEvent): void => {
		const line = JSON.stringify(event, jsonReplacer);
		console.log(line);
		if (logStream) {
			logStream.write(`${line}\n`);
		}
	};

	const emit = (event: { type: string; [key: string]: unknown }): void => {
		if (!shouldEmit(event.type, logLevel)) {
			return;
		}

		const fullEvent: DaemonEvent = {
			source: "nexus",
			at: nowIso(),
			...event,
		};

		writeEvent(fullEvent);

		if (!prettyLogger) {
			return;
		}

		const type = String(event.type);
		if (type === "connected") {
			prettyLogger.info("Connected to Nexus");
		} else if (type === "reconnected") {
			prettyLogger.success("Reconnected to Nexus");
		} else if (type === "disconnected") {
			prettyLogger.warn("Disconnected from Nexus");
		} else if (type === "reconnecting") {
			prettyLogger.info("Reconnecting to Nexus");
		} else if (type === "auth_failed") {
			prettyLogger.error("Authentication failed");
		} else if (type === "heartbeat_failed") {
			prettyLogger.warn("Heartbeat failed repeatedly");
		} else if (type === "shutdown") {
			prettyLogger.info("Nexus daemon shutting down");
		}
	};

	let stopping = false;
	let stopSignal: "SIGINT" | "SIGTERM" | null = null;

	const stopWaiter = new Promise<void>((resolve) => {
		const onSigint = () => {
			if (stopping) {
				return;
			}
			stopping = true;
			stopSignal = "SIGINT";
			resolve();
		};
		const onSigterm = () => {
			if (stopping) {
				return;
			}
			stopping = true;
			stopSignal = "SIGTERM";
			resolve();
		};
		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);
	});

	let reconnectAttempt = 0;
	let downtimeStartedAt: number | null = null;
	let hasConnectedOnce = false;

	while (!stopping) {
		let sessionEnd: SessionEnd | null = null;

		try {
			await withAuth(
				{
					host: args.host,
					module: args.module,
					wallet: args.wallet,
					onDisconnect: (...disconnectArgs: unknown[]) => {
						if (!sessionEnd) {
							sessionEnd = {
								reason: "disconnected",
								details: disconnectArgs.map(sanitizeValue),
							};
						}
					},
				},
				async (ctx) => {
					const effectiveWallet = ctx.auth?.wallet || args.wallet || null;
					const currentAgent = ctx
						.iter<Agent>("agents")
						.find(
							(a) => a.identity.toHexString() === ctx.identity?.toHexString(),
						);

					if (!hasConnectedOnce) {
						emit({
							type: "connected",
							identity: ctx.identity?.toHexString(),
							wallet: effectiveWallet,
							host: args.host || ctx.config.spacetime.host,
							module: args.module || ctx.config.spacetime.module,
						});
					} else {
						emit({
							type: "reconnected",
							attempts: reconnectAttempt,
							downtime_ms: downtimeStartedAt
								? Date.now() - downtimeStartedAt
								: null,
							identity: ctx.identity?.toHexString(),
						});
					}

					hasConnectedOnce = true;
					reconnectAttempt = 0;
					downtimeStartedAt = null;

					emit({ type: "subscription_applied" });
					emit({
						type: "ready",
						identity: ctx.identity?.toHexString(),
						wallet: effectiveWallet,
						log_file: args["log-file"] || null,
						log_level: logLevel,
						auto_heartbeat: !!currentAgent,
					});

					if (logLevel === "debug") {
						for (const tableSpec of OBSERVED_TABLES) {
							const table = ctx.db[tableSpec.key] as ObservableTable;
							table.onInsert?.((_eventCtx, row) => {
								if (
									args.sender &&
									(tableSpec.name === "messages" ||
										tableSpec.name === "project_messages")
								) {
									const senderId = (row as { senderId?: unknown }).senderId;
									if (senderId !== args.sender) {
										return;
									}
								}
								emit({
									type: "table_insert",
									table: tableSpec.name,
									row: sanitizeValue(row),
								});
							});

							table.onUpdate?.((_eventCtx, oldRow, newRow) => {
								if (
									args.sender &&
									(tableSpec.name === "messages" ||
										tableSpec.name === "project_messages")
								) {
									const senderId = (newRow as { senderId?: unknown }).senderId;
									if (senderId !== args.sender) {
										return;
									}
								}
								emit({
									type: "table_update",
									table: tableSpec.name,
									old_row: sanitizeValue(oldRow),
									new_row: sanitizeValue(newRow),
								});
							});

							table.onDelete?.((_eventCtx, row) => {
								if (
									args.sender &&
									(tableSpec.name === "messages" ||
										tableSpec.name === "project_messages")
								) {
									const senderId = (row as { senderId?: unknown }).senderId;
									if (senderId !== args.sender) {
										return;
									}
								}
								emit({
									type: "table_delete",
									table: tableSpec.name,
									row: sanitizeValue(row),
								});
							});
						}
					}

					let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
					let heartbeatInFlight = false;
					let consecutiveHeartbeatFailures = 0;

					const scheduleHeartbeat = () => {
						if (stopping || !currentAgent) {
							return;
						}

						heartbeatTimer = setTimeout(async () => {
							if (!currentAgent || heartbeatInFlight || stopping) {
								scheduleHeartbeat();
								return;
							}

							heartbeatInFlight = true;
							try {
								await callReducer(ctx, "heartbeat", {
									agentId: currentAgent.id,
								});
								if (consecutiveHeartbeatFailures > 0) {
									emit({
										type: "heartbeat_recovered",
										failed_count_before_recovery: consecutiveHeartbeatFailures,
									});
								}
								consecutiveHeartbeatFailures = 0;
							} catch (err) {
								consecutiveHeartbeatFailures += 1;
								if (
									consecutiveHeartbeatFailures >= HEARTBEAT_FAILURE_THRESHOLD &&
									!sessionEnd
								) {
									sessionEnd = {
										reason: "heartbeat_failed",
										details: {
											consecutive_failures: consecutiveHeartbeatFailures,
											message: normalizeError(err),
										},
									};
									emit({
										type: "heartbeat_failed",
										consecutive_failures: consecutiveHeartbeatFailures,
										message: normalizeError(err),
									});
								}
							} finally {
								heartbeatInFlight = false;
								scheduleHeartbeat();
							}
						}, withJitter(HEARTBEAT_INTERVAL_MS));
					};

					if (currentAgent) {
						scheduleHeartbeat();
					}

					while (!stopping && !sessionEnd) {
						await Promise.race([stopWaiter, sleep(200)]);
					}

					if (heartbeatTimer) {
						clearTimeout(heartbeatTimer);
					}
				},
			);
		} catch (err) {
			const message = normalizeError(err);
			if (connectErrorLooksAuthRelated(message)) {
				emit({ type: "auth_failed", message });
				break;
			}

			emit({ type: "subscription_error", message });
			sessionEnd = {
				reason: "disconnected",
				details: { message },
			};
		}

		if (stopping) {
			break;
		}

		const reason = sessionEnd?.reason || "disconnected";
		emit({
			type: "disconnected",
			reason,
			details: sanitizeValue(sessionEnd?.details || null),
		});

		if (downtimeStartedAt === null) {
			downtimeStartedAt = Date.now();
		}

		reconnectAttempt += 1;
		const waitMs = backoffMs(reconnectAttempt);
		emit({
			type: "reconnecting",
			attempt: reconnectAttempt,
			backoff_ms: waitMs,
		});

		await Promise.race([stopWaiter, sleep(waitMs)]);
	}

	emit({ type: "shutdown", signal: stopSignal || "unknown" });

	if (logStream) {
		logStream.end();
	}
}

export default defineCommand({
	meta: {
		name: "nexus",
		description: "Persistent Nexus daemon (keepalive + critical telemetry)",
	},
	args: nexusDaemonArgs,
	async run({ args }) {
		if (forceHelpRequested()) {
			printHelp({
				command: "probe nexus",
				description: "Run persistent Nexus keepalive + critical event logger",
				usage: [
					"probe nexus [options]",
					"probe nexus --wallet agent-wallet",
					"probe nexus --wallet agent-wallet --log-file ./logs/nexus-events.jsonl",
					"probe nexus --log-level debug --sender zoe-1",
					"probe nexus --pretty",
				],
				options: [
					{
						name: "--wallet",
						detail: "Wallet for authenticated persistent connection",
					},
					{
						name: "--host, --module",
						detail: "Nexus SpacetimeDB target overrides",
					},
					{ name: "--log-level", detail: "critical (default), info, or debug" },
					{
						name: "--sender",
						detail: "Sender filter for debug message events only",
					},
					{
						name: "--log-file",
						detail: "Optional JSONL file path for daemon events",
					},
					{
						name: "--pretty",
						detail: "Human-readable lifecycle logs to stderr",
					},
				],
				notes: [
					"stdout is always structured JSONL for machine parsing.",
					"Default mode logs critical connection lifecycle and heartbeat health events only.",
					"Use --log-level debug to emit full table insert/update/delete payloads.",
				],
			});
			return;
		}

		await runNexusDaemon(args as Record<string, unknown>);
	},
});
