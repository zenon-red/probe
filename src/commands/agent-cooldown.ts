import { defineCommand } from "citty";
import { callReducer, withAuth } from "~/utils/context.js";
import { identityHex } from "~/utils/enums.js";
import { applyJsonMode, error, isJsonMode, success } from "~/utils/output.js";

function getAgentRow(ctx: {
  db: unknown;
  auth?: { identity: unknown };
}): Record<string, unknown> | undefined {
  const db = ctx.db as Record<string, { iter?: () => IterableIterator<Record<string, unknown>> }>;
  const table = db["agents"];
  if (!table?.iter) return undefined;
  const agents = Array.from(table.iter());
  return agents.find((agent) => identityHex(agent.identity) === identityHex(ctx.auth?.identity));
}

function getConfigRows(ctx: { db: unknown }): Record<string, unknown>[] {
  const db = ctx.db as Record<string, { iter?: () => IterableIterator<Record<string, unknown>> }>;
  const table = db["config"];
  if (!table?.iter) return [];
  return Array.from(table.iter());
}

export const agentCooldownShowCommand = defineCommand({
  meta: { name: "show", description: "Show current cadence policy" },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await withAuth(
      {
        wallet: args.wallet,

        subscribe: ["SELECT * FROM agents", "SELECT * FROM config"],
      },
      async (ctx) => {
        const agent = getAgentRow(ctx);
        if (!agent) {
          error("AGENT_NOT_FOUND", "Agent not found. Are you registered?");
        }

        const configs = getConfigRows(ctx);
        const globalDefault = configs.find((c) => c.key === "dispatch_cooldown_secs");
        const globalDefaultSecs = globalDefault ? Number(globalDefault.value) : 3600;

        // Per-agent cooldown: null = inherit, Some(0) = off, Some(N) = N seconds
        // The field may not exist yet if STDB hasn't been updated
        const perAgentCooldown = (agent as Record<string, unknown>).dispatchCooldownSecs as
          | number
          | null
          | undefined;

        let effectiveSecs: number;
        let source: string;

        if (perAgentCooldown === null || perAgentCooldown === undefined) {
          effectiveSecs = globalDefaultSecs;
          source = "inheriting global default";
        } else if (perAgentCooldown === 0) {
          effectiveSecs = 0;
          source = "no cooldown (off)";
        } else {
          effectiveSecs = perAgentCooldown;
          source = "per-agent override";
        }

        const formatDuration = (secs: number): string => {
          if (secs === 0) return "No cooldown";
          if (secs < 60) return `${secs}s`;
          if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          return m > 0 ? `${h}h ${m}m` : `${h}h`;
        };

        if (isJsonMode()) {
          success({
            per_agent_cooldown_secs: perAgentCooldown ?? null,
            global_default_secs: globalDefaultSecs,
            effective_secs: effectiveSecs,
            source,
          });
        } else {
          console.log(
            `Per-agent: ${perAgentCooldown !== null && perAgentCooldown !== undefined ? formatDuration(perAgentCooldown) : "inheriting global default"}`,
          );
          console.log(`Global default: ${formatDuration(globalDefaultSecs)}`);
          console.log(`Effective: ${formatDuration(effectiveSecs)} (${source})`);
        }
      },
    );
  },
});

export const agentCooldownSetCommand = defineCommand({
  meta: { name: "set", description: "Set per-agent cooldown in seconds" },
  args: {
    secs: { type: "positional", name: "secs", description: "Cooldown in seconds", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const secs = Number(args.secs);

    if (isNaN(secs) || secs < 0) {
      error("INVALID_VALUE", "Cooldown must be a non-negative number of seconds.");
    }

    await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
      await callReducer(ctx, ctx.conn.reducers.setDispatchCooldown, {
        cooldownSecs: secs,
      });

      if (isJsonMode()) {
        success({ cooldown_secs: secs });
      } else {
        success(`Cooldown set to ${secs}s.`);
      }
    });
  },
});

export const agentCooldownOffCommand = defineCommand({
  meta: { name: "off", description: "Disable cooldown (set to 0)" },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
      await callReducer(ctx, ctx.conn.reducers.setDispatchCooldown, {
        cooldownSecs: 0,
      });

      if (isJsonMode()) {
        success({ cooldown_secs: 0, status: "off" });
      } else {
        success("Cooldown disabled.");
      }
    });
  },
});

export const agentCooldownInheritCommand = defineCommand({
  meta: { name: "inherit", description: "Reset cooldown to inherit global default" },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await withAuth({ wallet: args.wallet, subscribe: [] }, async (ctx) => {
      await callReducer(ctx, ctx.conn.reducers.setDispatchCooldown, {
        cooldownSecs: undefined,
      });

      if (isJsonMode()) {
        success({ status: "inheriting" });
      } else {
        success("Cooldown reset to inherit global default.");
      }
    });
  },
});

export default defineCommand({
  meta: {
    name: "cooldown",
    description: "Manage agent dispatch cooldown",
  },
  subCommands: {
    show: agentCooldownShowCommand,
    set: agentCooldownSetCommand,
    off: agentCooldownOffCommand,
    inherit: agentCooldownInheritCommand,
  },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  run() {
    console.log("Usage: probe agent cooldown <show|set|off|inherit> [args]");
  },
});
