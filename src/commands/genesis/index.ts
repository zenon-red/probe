import { defineCommand } from "citty";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { applyGenesisFromSource, GENESIS_SUBSCRIBE, syncGenesis } from "~/utils/genesis-apply.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { error } from "~/utils/output.js";

const connectionArgs = {
  wallet: { type: "string", description: "Wallet name" },
  host: { type: "string", description: "SpacetimeDB host" },
  module: { type: "string", description: "Module name" },
  json: { type: "boolean", description: "JSON output", default: false },
} as const;

type GenesisConnectionArgs = { wallet?: string; host?: string; module?: string };

const applyCommand = defineCommand({
  meta: { name: "apply", description: "Validate, hash, and apply Genesis from path or URL" },
  args: {
    source: {
      type: "positional",
      description: "Path or URL to genesis.json",
      required: true,
    },
    verify: {
      type: "boolean",
      description: "Verify org.githubOrg via gh api",
      default: false,
    },
    "push-to-nexus": {
      type: "boolean",
      description: "Call apply_genesis when caller is Zoe/Admin",
      default: false,
    },
    "install-skills": {
      type: "boolean",
      description: "Run skills install for genesis source/ref",
      default: false,
    },
    ...connectionArgs,
  },
  async run({ args }) {
    applyJsonMode(args);
    const source = String(args.source || "").trim();
    if (!source) error("ARGS_REQUIRED", "Genesis source path or URL required");

    await withAuth(
      commandContextOptions(args as GenesisConnectionArgs, { subscribe: GENESIS_SUBSCRIBE }),
      async (ctx) => {
        const result = await applyGenesisFromSource(ctx, source, {
          verifyOrg: !!args.verify,
          pushToNexus: !!args["push-to-nexus"],
          installSkills: !!args["install-skills"],
        });
        success({
          genesis_hash: result.genesisHash,
          genesis_id: result.parsed.genesisId,
          genesis_version: result.parsed.genesisVersion,
          github_org: result.parsed.githubOrg,
          persisted_source: result.persistedSource,
          pushed_to_nexus: result.pushedToNexus,
          sync_status: result.syncStatus,
          skills_install: result.skillsInstallCommand,
          issuer: result.parsed.issuer,
          spacetime_host: result.parsed.spacetimeHost,
          spacetime_module: result.parsed.spacetimeModule,
        });
      },
    );
  },
});

const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Re-apply Genesis from persisted source or Nexus genesis_url",
  },
  args: {
    source: {
      type: "string",
      description: "Override genesis source path or URL",
    },
    verify: {
      type: "boolean",
      description: "Verify org.githubOrg via gh api",
      default: false,
    },
    "push-to-nexus": {
      type: "boolean",
      description: "Call apply_genesis when caller is Zoe/Admin",
      default: false,
    },
    "install-skills": {
      type: "boolean",
      description: "Run skills install for genesis source/ref",
      default: false,
    },
    ...connectionArgs,
  },
  async run({ args }) {
    applyJsonMode(args);

    await withAuth(
      commandContextOptions(args as GenesisConnectionArgs, { subscribe: GENESIS_SUBSCRIBE }),
      async (ctx) => {
        const result = await syncGenesis(ctx, {
          source: args.source ? String(args.source) : undefined,
          verifyOrg: !!args.verify,
          pushToNexus: !!args["push-to-nexus"],
          installSkills: !!args["install-skills"],
        });
        success({
          genesis_hash: result.genesisHash,
          sync_status: result.syncStatus,
          persisted_source: result.persistedSource,
          pushed_to_nexus: result.pushedToNexus,
        });
      },
    );
  },
});

export default defineSubcommandParent({
  name: "genesis",
  description: "Genesis environment contract: apply and sync",
  args: connectionArgs,
  help: {
    command: "probe genesis",
    description: "Genesis environment contract: apply and sync",
    usage: [
      "probe genesis <subcommand> [args]",
      "probe genesis apply ./genesis.json",
      "probe genesis sync",
    ],
    actions: [
      { name: "apply <source>", detail: "Validate, hash, and apply Genesis" },
      { name: "sync", detail: "Re-apply Genesis from persisted source" },
    ],
  },
  subCommands: {
    apply: applyCommand,
    sync: syncCommand,
  },
});
