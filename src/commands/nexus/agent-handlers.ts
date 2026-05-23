import { getConfig } from "~/utils/config.js";
import {
  AGENT_SUBSCRIBE,
  type Agent,
  CommandContext,
  callReducer,
  callProcedure,
  withAuth,
} from "~/utils/context.js";
import { AgentRole, AgentStatus } from "~/utils/enums.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { error, success } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { getWalletInfo } from "~/utils/wallet.js";
import type { GenerateVoiceResult } from "~/module_bindings/types.js";

const MAX_VOICE_TRANSCRIPT_LENGTH = 500;
const DEFAULT_VOICE_CONTEXT_TYPE = "status_update";

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
  agent?: string;
  clear?: boolean;
  audioUrl?: string;
  contextType?: string;
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

export const currentAgentForIdentity = (ctx: CommandContext): Agent | undefined => {
  return ctx
    .iter<Agent>("agents")
    .find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
};

const renderAgentBio = (agent: Agent) => ({
  agentId: agent.id,
  name: agent.name,
  bio: agent.bio,
});

const cooldownMovedHint = (sub?: string, setSecs?: string): string => {
  const validSubs = new Set(["show", "set", "off", "inherit"]);
  if (sub && validSubs.has(sub)) {
    const secs = sub === "set" && setSecs ? ` ${setSecs}` : "";
    return `Use: probe cooldown ${sub}${secs}`;
  }
  return "Did you mean: probe cooldown";
};

export const runAgentAction = async (args: AgentCommandArgs): Promise<void> => {
  const action = args.action;
  if (!action) {
    error("ACTION_REQUIRED", "Agent action required");
  }

  if (action === "cooldown") {
    error(
      "INVALID_ACTION",
      "`probe agent cooldown` was removed",
      cooldownMovedHint(args.agentId, args.name),
    );
  }

  try {
    switch (action) {
      case "register": {
        const agentId = args.agentId;
        const name = args.name;
        const role = args.role || "zeno";

        if (!agentId || !name) error("ARGS_REQUIRED", "Agent ID and name required");

        const config = await getConfig();
        const walletName = args.wallet || config.defaultWallet;
        if (!args.address && !walletName)
          error("WALLET_REQUIRED", "--address or --wallet required (or set default wallet)");

        let address = args.address;
        const capabilities = normalizeCapabilities(args.capabilities);
        if (!address && walletName) {
          const wallet = await getWalletInfo(walletName);
          if (!wallet) error("WALLET_NOT_FOUND", `Wallet not found: ${walletName}`);
          address = wallet.address;
        }

        try {
          await withAuth(
            {
              wallet: walletName,
              subscribe: AGENT_SUBSCRIBE,
            },
            async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.registerAgent, {
                agentId,
                name,
                role: AgentRole.fromString(role),
                zenonAddress: address as string,
              });

              if (capabilities.length > 0) {
                await callReducer(ctx, ctx.conn.reducers.updateAgentCapabilities, {
                  capabilities,
                });
              }

              await new Promise((r) => setTimeout(r, 500));
              const registered = ctx.iter<Agent>("agents").find((a) => a.id === agentId);
              if (!registered) {
                if (role === "zoe" || role === "admin") {
                  error("UNAUTHORIZED", "Only whitelisted identities can register as zoe or admin");
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
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
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
          {
            wallet: args.wallet,
            subscribe: AGENT_SUBSCRIBE,
          },
          async (ctx) => {
            const myAgent = currentAgentForIdentity(ctx);
            if (!myAgent)
              error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");

            success(myAgent);
          },
        );
        break;
      }

      case "set-status": {
        const nextStatus = args.agentId;
        if (!nextStatus) {
          error("STATUS_REQUIRED", "Status required. Use: online, offline, working, busy");
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
          error("TASK_REQUIRED", "--task is required when setting status to working");
        }
        if (!isWorking && args.task) {
          error("TASK_NOT_ALLOWED", "--task is only allowed when setting status to working");
        }

        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: AGENT_SUBSCRIBE,
            },
            async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.setAgentStatus, {
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
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "capabilities": {
        if (!args.set) error("CAPABILITIES_REQUIRED", "--set is required");

        const capabilities = normalizeCapabilities(args.set);
        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: AGENT_SUBSCRIBE,
            },
            async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.updateAgentCapabilities, {
                capabilities,
              });
              const myAgent = currentAgentForIdentity(ctx);
              success({ updated: true, agentId: myAgent?.id, capabilities });
            },
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "me": {
        await withAuth(
          {
            wallet: args.wallet,
            subscribe: AGENT_SUBSCRIBE,
          },
          async (ctx) => {
            const myAgent = currentAgentForIdentity(ctx);
            if (!myAgent)
              error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");

            success(myAgent);
          },
        );
        break;
      }

      case "bio": {
        const bioFromPositional = args.agentId?.trim();
        const hasSet = typeof args.set === "string";
        const hasClear = Boolean(args.clear);
        const hasPositionalBio = Boolean(bioFromPositional);
        const targetAgentId = args.agent?.trim();

        if (hasSet && hasClear) {
          error("INVALID_USAGE", "Use either --set or --clear, not both.");
        }
        if (hasSet && hasPositionalBio) {
          error(
            "INVALID_USAGE",
            "Provide bio text either as positional argument or --set, not both.",
          );
        }
        if (targetAgentId && (hasSet || hasClear || hasPositionalBio)) {
          error(
            "INVALID_USAGE",
            "--agent is read-only. Do not combine with --set, --clear, or positional bio text.",
          );
        }

        const isWrite = hasSet || hasClear || hasPositionalBio;

        if (isWrite) {
          const bio = hasClear ? "" : (hasSet ? args.set : bioFromPositional) || "";
          try {
            await withAuth(
              {
                wallet: args.wallet,
                subscribe: AGENT_SUBSCRIBE,
              },
              async (ctx) => {
                await callReducer(ctx, ctx.conn.reducers.updateAgentBio, { bio });
                const myAgent = currentAgentForIdentity(ctx);
                success({
                  updated: true,
                  agentId: myAgent?.id,
                  bio,
                });
              },
            );
          } catch (err) {
            error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
          }
          break;
        }

        if (targetAgentId) {
          await using ctx = await CommandContext.create({
            subscribe: AGENT_SUBSCRIBE,
          });
          const agent = ctx.iter<Agent>("agents").find((a) => a.id === targetAgentId);
          if (!agent) {
            error("AGENT_NOT_FOUND", `Agent not found: ${targetAgentId}`);
          }
          success(renderAgentBio(agent));
          break;
        }

        await withAuth(
          {
            wallet: args.wallet,
            subscribe: AGENT_SUBSCRIBE,
          },
          async (ctx) => {
            const myAgent = currentAgentForIdentity(ctx);
            if (!myAgent)
              error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");

            success(renderAgentBio(myAgent));
          },
        );
        break;
      }

      case "heartbeat": {
        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: AGENT_SUBSCRIBE,
            },
            async (ctx) => {
              const myAgent = currentAgentForIdentity(ctx);
              if (!myAgent) error("NOT_REGISTERED", "Agent not registered");

              await callReducer(ctx, ctx.conn.reducers.heartbeat, {
                agentId: myAgent.id,
              });
              success({ heartbeat: true });
            },
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "list": {
        await using ctx = await CommandContext.create();
        const limit = args.limit ? parseInt(args.limit, 10) : undefined;
        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          error("INVALID_LIMIT", "--limit must be a positive integer");
        }

        let onlineAgents = ctx
          .iter<Agent>("agents")
          .filter((a) => !AgentStatus.is.offline(a.status));
        onlineAgents = onlineAgents.sort((a, b) => {
          const aMicros = toMicros(a.lastHeartbeat || a.createdAt || a.lastActiveAt);
          const bMicros = toMicros(b.lastHeartbeat || b.createdAt || b.lastActiveAt);
          if (aMicros !== bMicros) return bMicros > aMicros ? 1 : -1;
          return b.id.localeCompare(a.id);
        });
        if (limit !== undefined) onlineAgents = onlineAgents.slice(0, limit);

        success({ agents: onlineAgents, count: onlineAgents.length });
        break;
      }

      case "identity": {
        await withAuth(
          {
            wallet: args.wallet,
            subscribe: AGENT_SUBSCRIBE,
          },
          async (ctx) => {
            const identityHex = ctx.identity?.toHexString();
            success({ identity: identityHex, wallet: args.wallet });
          },
        );
        break;
      }

      case "voice": {
        const transcript = args.agentId?.trim();
        if (!transcript) {
          error(
            "TRANSCRIPT_REQUIRED",
            "Transcript required. Provide as first positional argument.",
          );
        }
        if (transcript.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
          error(
            "TRANSCRIPT_TOO_LONG",
            `Transcript exceeds ${MAX_VOICE_TRANSCRIPT_LENGTH} characters.`,
          );
        }
        if (!args.audioUrl) {
          error("AUDIO_URL_REQUIRED", "--audioUrl is required for voice announcements.");
        }

        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: AGENT_SUBSCRIBE,
            },
            async (ctx) => {
              const contextType = args.contextType || DEFAULT_VOICE_CONTEXT_TYPE;
              const result = await callProcedure<GenerateVoiceResult>(
                ctx,
                ctx.conn.procedures.generateVoice,
                {
                  transcript,
                  audioUrl: args.audioUrl,
                  contextType,
                },
              );

              const data = {
                ok: true,
                announcementId: result.id,
                seq: result.seq,
                agentName: result.agentName,
                keyPrefix: result.keyPrefix,
                audioUrl: args.audioUrl,
                contextType,
              };

              success(data);
            },
          );
        } catch (err) {
          error("PROCEDURE_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      default:
        error(
          "INVALID_ACTION",
          `Invalid action: ${action}`,
          "Use: register, status, set-status, capabilities, bio, me, heartbeat, list, identity, voice",
        );
    }
  } catch (err) {
    const message = errorMessage(err);
    failWithConnectionOrUnexpected(message);
  }
};
