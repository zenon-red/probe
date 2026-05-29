import { SUBCOMMAND_PARENTS } from "./subcommand-registry.js";
import { LEAF_HELP_OVERRIDES } from "./leaf-help-overrides.js";
import { JSON_FLAG_HELP_DETAIL } from "./help.js";

export const TOP_LEVEL_COMMAND_DESCRIPTIONS: Record<string, string> = {
  wallet: "Wallet lifecycle commands",
  login: "Authenticate wallet and cache token",
  auth: "Inspect cached authentication status",
  token: "Inspect or clear cached token",
  sign: "Sign text payloads",
  nexus: "Run persistent Nexus daemon (action executor + heartbeat)",
  agent: "Agent identity and status",
  cooldown: "Dispatch cadence: show, set, off, inherit",
  task: "Task lifecycle and claiming",
  idea: "Idea proposal and voting",
  discover: "Discovery reporting and review",
  message: "Channel and project messaging",
  project: "Project management",
  action: "Action lifecycle: show, complete, fail, skip",
  artifact: "Register and list action artifacts",
  review: "Complete review and validation actions",
  query: "Execute SQL queries against Nexus",
  doctor: "Run setup and connectivity diagnostics",
  onboard: "Idempotent agent setup for autonomous participation",
  genesis: "Apply and sync org/environment Genesis manifest",
  whoami: "Show current authenticated agent profile",
  upgrade: "Upgrade Probe and sync genesis toolchain",
  version: "Report probe, skills@ref, and OpenSpec versions",
  config: "Read/write CLI configuration",
  admin: "Privileged ops (e.g. assign Human role)",
};

export const ROOT_HELP_COMMAND_ORDER = [
  "wallet",
  "login",
  "auth",
  "token",
  "sign",
  "nexus",
  "agent",
  "cooldown",
  "task",
  "idea",
  "discover",
  "message",
  "project",
  "action",
  "artifact",
  "review",
  "query",
  "doctor",
  "onboard",
  "genesis",
  "whoami",
  "upgrade",
  "version",
  "config",
  "admin",
] as const;

const STANDALONE_COMMANDS = [
  "login",
  "sign",
  "nexus",
  "query",
  "doctor",
  "onboard",
  "upgrade",
  "whoami",
  "version",
] as const;

export function rootHelpDiscoveryJson(description: string): Record<string, unknown> {
  const commands: Record<string, unknown> = {};
  for (const [parent, subs] of Object.entries(SUBCOMMAND_PARENTS)) {
    const subcommands: Record<string, unknown> = {};
    for (const sub of subs) {
      const path = `probe ${parent} ${sub}`;
      const override = LEAF_HELP_OVERRIDES[path];
      subcommands[sub] = override
        ? {
            command: path,
            description: override.description,
            usage: override.usage,
            ...(override.options ? { options: override.options } : {}),
          }
        : { command: path };
    }
    commands[parent] = {
      description: TOP_LEVEL_COMMAND_DESCRIPTIONS[parent] ?? parent,
      subcommands,
    };
  }

  const standalone = Object.fromEntries(
    STANDALONE_COMMANDS.map((cmd) => [
      cmd,
      {
        command: `probe ${cmd}`,
        description: TOP_LEVEL_COMMAND_DESCRIPTIONS[cmd]!,
      },
    ]),
  );

  return {
    command: "probe",
    description,
    global_options: [{ name: "--json", detail: JSON_FLAG_HELP_DETAIL }],
    commands,
    standalone,
  };
}
