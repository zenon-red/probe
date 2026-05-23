import { defineCommand } from "citty";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { identityHex } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";

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
      commandContextOptions(args, {
        subscribe: ["SELECT * FROM agents", "SELECT * FROM config"],
      }),
      async (ctx) => {
        const agent = ctx.agents.find(
          (row) => identityHex(row.identity) === identityHex(ctx.auth?.identity),
        );
        if (!agent) {
          error("AGENT_NOT_FOUND", "Agent not found. Are you registered?");
        }

        const globalDefault = ctx.stdbConfig.find((c) => c.key === "dispatch_cooldown_secs");
        const globalDefaultSecs = globalDefault ? Number(globalDefault.value) : 3600;

        const perAgentCooldown = agent.dispatchCooldownSecs;

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

        success({
          per_agent_cooldown_secs: perAgentCooldown ?? null,
          global_default_secs: globalDefaultSecs,
          effective_secs: effectiveSecs,
          source,
        });
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

    await runReducerCommand(args, {
      subscribe: [],
      reducer: (ctx) => ctx.conn.reducers.setDispatchCooldown,
      params: { cooldownSecs: secs },
    });

    success({ cooldown_secs: secs, message: `Cooldown set to ${secs}s` });
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

    await runReducerCommand(args, {
      subscribe: [],
      reducer: (ctx) => ctx.conn.reducers.setDispatchCooldown,
      params: { cooldownSecs: 0 },
    });

    success({ cooldown_secs: 0, status: "off", message: "Cooldown disabled" });
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

    await runReducerCommand(args, {
      subscribe: [],
      reducer: (ctx) => ctx.conn.reducers.setDispatchCooldown,
      params: { cooldownSecs: undefined },
    });

    success({ status: "inheriting", message: "Cooldown reset to inherit global default" });
  },
});

import { defineSubcommandParent } from "~/utils/subcommand.js";

export default defineSubcommandParent({
  name: "cooldown",
  description: "Manage agent dispatch cooldown",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  help: {
    command: "probe cooldown",
    description: "Dispatch cadence: show, set, off, inherit",
    usage: ["probe cooldown <subcommand> [options]", "probe cooldown show"],
    actions: [
      { name: "show", detail: "Show current cadence policy" },
      { name: "set", detail: "Set cooldown seconds" },
      { name: "off", detail: "Disable cooldown" },
      { name: "inherit", detail: "Inherit global cooldown default" },
    ],
  },
  subCommands: {
    show: agentCooldownShowCommand,
    set: agentCooldownSetCommand,
    off: agentCooldownOffCommand,
    inherit: agentCooldownInheritCommand,
  },
});
