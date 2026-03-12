import { getConfig } from "~/utils/config.js";
import {
	type Agent,
	CommandContext,
	callReducer,
	withAuth,
} from "~/utils/context.js";
import { AgentRole, AgentStatus } from "~/utils/enums.js";
import { error, isJsonMode, success } from "~/utils/output.js";
import { formatTimestamp, toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";
import { getWalletInfo } from "~/utils/wallet.js";

export interface AgentCommandArgs {
	action?: string;
	agentId?: string;
	name?: string;
	role?: string;
	address?: string;
	wallet?: string;
	task?: string;
	limit?: string;
	capabilities?: string;
	set?: string;
	host?: string;
	module?: string;
}

const normalizeCapabilities = (value?: string): string[] => {
	if (!value) return [];
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim().toLowerCase())
				.filter(Boolean),
		),
	];
};

const currentAgentForIdentity = (ctx: CommandContext): Agent | undefined => {
	return ctx
		.iter<Agent>("agents")
		.find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
};

const renderAgent = (agent: Agent, identity?: string) => ({
	id: agent.id,
	name: agent.name,
	role: AgentRole.display(agent.role),
	status: AgentStatus.display(agent.status),
	lastHeartbeat: formatTimestamp(agent.lastHeartbeat),
	currentTaskId: agent.currentTaskId ? agent.currentTaskId.toString() : "",
	capabilities: agent.capabilities.join(","),
	identity: identity || "",
});

export const runAgentAction = async (args: AgentCommandArgs): Promise<void> => {
	const action = args.action;
	if (!action) {
		error("ACTION_REQUIRED", "Agent action required");
	}

	try {
		switch (action) {
			case "register": {
				const agentId = args.agentId;
				const name = args.name;
				const role = args.role || "zeno";

				if (!agentId || !name)
					error("ARGS_REQUIRED", "Agent ID and name required");

				const config = await getConfig();
				const walletName = args.wallet || config.defaultWallet;
				if (!args.address && !walletName)
					error(
						"WALLET_REQUIRED",
						"--address or --wallet required (or set default wallet)",
					);

				let address = args.address;
				const capabilities = normalizeCapabilities(args.capabilities);
				if (!address && walletName) {
					const wallet = await getWalletInfo(walletName);
					if (!wallet)
						error("WALLET_NOT_FOUND", `Wallet not found: ${walletName}`);
					address = wallet.address;
				}

				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: walletName },
						async (ctx) => {
							await callReducer(ctx, "registerAgent", {
								agentId,
								name,
								role: AgentRole.fromString(role),
								zenonAddress: address as string,
							});

							if (capabilities.length > 0) {
								await callReducer(ctx, "updateAgentCapabilities", {
									capabilities,
								});
							}

							await new Promise((r) => setTimeout(r, 500));
							const registered = ctx
								.iter<Agent>("agents")
								.find((a) => a.id === agentId);
							if (!registered) {
								if (role === "zoe" || role === "admin") {
									error(
										"UNAUTHORIZED",
										"Only whitelisted identities can register as zoe or admin",
									);
								}
								error("REGISTRATION_FAILED", "Registration failed");
							}
						},
					);
					success({
						registered: true,
						agentId,
						name,
						role,
						address,
						capabilities,
					});
					if (!isJsonMode()) {
						console.log(
							toonList("agent_registered", [
								{
									agentId,
									name,
									role,
									address,
									capabilities: capabilities.join(","),
								},
							]),
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "status": {
				if (args.agentId || args.task || args.capabilities) {
					error(
						"INVALID_USAGE",
						"Use `probe agent set-status <online|offline|working|busy>` to update status. `probe agent status` only shows current status.",
					);
				}

				await withAuth(
					{ host: args.host, module: args.module, wallet: args.wallet },
					async (ctx) => {
						const myAgent = currentAgentForIdentity(ctx);
						if (!myAgent)
							error(
								"NOT_REGISTERED",
								"Agent not registered. Run `probe agent register` first.",
							);

						success(myAgent);
						if (!isJsonMode()) {
							console.log(
								toonList("agent", [
									renderAgent(myAgent, ctx.identity?.toHexString()),
								]),
							);
						}
					},
				);
				break;
			}

			case "set-status": {
				const nextStatus = args.agentId;
				if (!nextStatus) {
					error(
						"STATUS_REQUIRED",
						"Status required. Use: online, offline, working, busy",
					);
				}
				if (args.capabilities) {
					error(
						"INVALID_USAGE",
						"Use `probe agent capabilities --set <list>` to update capabilities.",
					);
				}

				const normalized = nextStatus.toLowerCase();
				const allowed = new Set(["online", "offline", "working", "busy"]);
				if (!allowed.has(normalized)) {
					error(
						"INVALID_STATUS",
						`Invalid status: ${nextStatus}. Use: online, offline, working, busy`,
					);
				}

				const mapped = AgentStatus.fromString(normalized);
				const isWorking = AgentStatus.is.working(mapped);
				if (isWorking && !args.task) {
					error(
						"TASK_REQUIRED",
						"--task is required when setting status to working",
					);
				}
				if (!isWorking && args.task) {
					error(
						"TASK_NOT_ALLOWED",
						"--task is only allowed when setting status to working",
					);
				}

				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "setAgentStatus", {
								status: mapped,
								taskId: isWorking ? BigInt(args.task as string) : undefined,
							});
						},
					);

					success({
						updated: true,
						status: normalized,
						taskId: args.task || null,
					});
					if (!isJsonMode()) {
						console.log(
							toonList("agent_status_updated", [
								{
									status: normalized,
									taskId: args.task || "",
								},
							]),
						);
					}
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "capabilities": {
				if (!args.set) error("CAPABILITIES_REQUIRED", "--set is required");

				const capabilities = normalizeCapabilities(args.set);
				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							await callReducer(ctx, "updateAgentCapabilities", {
								capabilities,
							});
							const myAgent = currentAgentForIdentity(ctx);
							success({ updated: true, agentId: myAgent?.id, capabilities });
							if (!isJsonMode()) {
								console.log(
									toonList("agent_capabilities_updated", [
										{
											agentId: myAgent?.id || "",
											capabilities: capabilities.join(","),
										},
									]),
								);
							}
						},
					);
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "me": {
				await withAuth(
					{ host: args.host, module: args.module, wallet: args.wallet },
					async (ctx) => {
						const myAgent = currentAgentForIdentity(ctx);
						if (!myAgent)
							error(
								"NOT_REGISTERED",
								"Agent not registered. Run `probe agent register` first.",
							);

						success(myAgent);
						if (!isJsonMode()) {
							console.log(
								toonList("agent", [
									renderAgent(myAgent, ctx.identity?.toHexString()),
								]),
							);
						}
					},
				);
				break;
			}

			case "heartbeat": {
				try {
					await withAuth(
						{ host: args.host, module: args.module, wallet: args.wallet },
						async (ctx) => {
							const myAgent = currentAgentForIdentity(ctx);
							if (!myAgent) error("NOT_REGISTERED", "Agent not registered");

							await callReducer(ctx, "heartbeat", {
								agentId: myAgent.id,
							});
							success({ heartbeat: true });
							if (!isJsonMode()) {
								console.log(
									toonList("agent_heartbeat", [
										{
											agentId: myAgent.id,
											status: AgentStatus.display(myAgent.status),
										},
									]),
								);
							}
						},
					);
				} catch (err) {
					error(
						"REDUCER_FAILED",
						err instanceof Error ? err.message : "Unknown error",
					);
				}
				break;
			}

			case "list": {
				await using ctx = await CommandContext.create({
					host: args.host,
					module: args.module,
				});
				const limit = args.limit ? parseInt(args.limit, 10) : undefined;
				if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
					error("INVALID_LIMIT", "--limit must be a positive integer");
				}

				let onlineAgents = ctx
					.iter<Agent>("agents")
					.filter((a) => !AgentStatus.is.offline(a.status));
				onlineAgents = onlineAgents.sort((a, b) => {
					const aMicros = toMicros(
						a.lastHeartbeat || a.createdAt || a.lastActiveAt,
					);
					const bMicros = toMicros(
						b.lastHeartbeat || b.createdAt || b.lastActiveAt,
					);
					if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
					return b.id.localeCompare(a.id);
				});
				if (limit !== undefined) onlineAgents = onlineAgents.slice(0, limit);

				success({ agents: onlineAgents, count: onlineAgents.length });
				if (!isJsonMode()) {
					console.log(
						toonList(
							"agents",
							onlineAgents.map((a) => ({
								id: a.id,
								name: a.name,
								role: AgentRole.display(a.role),
								status: AgentStatus.display(a.status),
								last_heartbeat: formatTimestamp(a.lastHeartbeat),
								capabilities: a.capabilities.join(","),
							})),
						),
					);
				}
				break;
			}

			case "identity": {
				await withAuth(
					{ host: args.host, module: args.module, wallet: args.wallet },
					async (ctx) => {
						const identityHex = ctx.identity?.toHexString();
						success({ identity: identityHex, wallet: args.wallet });
						if (!isJsonMode()) {
							console.log(
								toonList("identity", [
									{
										identity: identityHex || "",
										wallet: args.wallet || "",
									},
								]),
							);
						}
					},
				);
				break;
			}

			default:
				error(
					"INVALID_ACTION",
					`Invalid action: ${action}`,
					"Use: register, status, set-status, capabilities, me, heartbeat, list, identity",
				);
		}
	} catch (err) {
		// Handle connection errors gracefully - avoid citty/consola stack traces
		const message = err instanceof Error ? err.message : String(err);
		error("CONNECTION_ERROR", message);
	}
};
