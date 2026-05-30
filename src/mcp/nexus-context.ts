import type { CommandContext } from "~/utils/context.js";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { getConfig, resolveSpacetimeArgs } from "~/utils/config.js";

const ACTION_SUBSCRIBE = [
  "SELECT * FROM agents",
  "SELECT * FROM agent_actions",
  "SELECT * FROM dispatch_route_config",
];

export function requiredBoundActionId(): bigint {
  const raw = process.env.PROBE_ACTION_ID?.trim();
  if (!raw) {
    throw new Error("PROBE_ACTION_ID is required for probe-nexus MCP");
  }
  return BigInt(raw);
}

export function assertBoundActionId(actionId: bigint): void {
  const bound = requiredBoundActionId();
  if (bound !== actionId) {
    throw new Error(`action_id ${actionId} does not match session-bound ${bound}`);
  }
}

export async function withNexusMcpContext<T>(
  run: (ctx: CommandContext, boundActionId: bigint) => Promise<T>,
): Promise<T> {
  const boundActionId = requiredBoundActionId();
  const wallet = process.env.PROBE_WALLET?.trim();
  if (!wallet) {
    throw new Error("PROBE_WALLET is required for probe-nexus MCP");
  }

  const cached = await getCachedToken(wallet);
  const token = process.env.PROBE_STDB_TOKEN?.trim() ?? cached?.token;
  if (!token) {
    throw new Error(`No cached token for wallet ${wallet}`);
  }

  const config = await getConfig();
  const { host, module } = resolveSpacetimeArgs(
    {
      host: process.env.PROBE_STDB_HOST,
      module: process.env.PROBE_STDB_MODULE,
    },
    config,
  );

  return withAuth(
    commandContextOptions({ wallet, host, module }, { token, subscribe: ACTION_SUBSCRIBE }),
    async (ctx) => run(ctx, boundActionId),
  );
}
