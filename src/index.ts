import { createRequire } from "node:module";
import { defineCommand, runMain } from "citty";
import auth from "./commands/auth.js";
import config from "./commands/config.js";
import doctor from "./commands/doctor.js";
import action from "./commands/action.js";
import agentCooldown from "./commands/agent-cooldown.js";
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
  JSON_FLAG_ARG_DESCRIPTION,
  JSON_FLAG_HELP_DETAIL,
  forceHelpRequested,
  normalizeHelpArgv,
  printConciseRootHelp,
  printHelp,
  setForceHelpRequested,
  suggestCommand,
} from "./utils/help.js";
import { error, isJsonMode } from "./utils/output.js";
import { errorMessage } from "./utils/errors.js";

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
  "cooldown",
  "doctor",
  "whoami",
  "upgrade",
  "onboard",
  "action",
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
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  run() {
    const argv = process.argv.slice(2);
    const firstPositional = argv.find((arg) => !arg.startsWith("-"));
    if (firstPositional && topLevelCommands.has(firstPositional)) {
      return;
    }

    if (forceHelpRequested() || argv.includes("--help") || argv.includes("-h")) {
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
            detail: "Run persistent Nexus daemon (action executor + heartbeat)",
          },
          { name: "agent", detail: "Agent identity and status" },
          { name: "cooldown", detail: "Dispatch cadence: show, set, off, inherit" },
          { name: "task", detail: "Task lifecycle and claiming" },
          { name: "idea", detail: "Idea proposal and voting" },
          { name: "discover", detail: "Discovery reporting and review" },
          { name: "message", detail: "Channel and project messaging" },
          { name: "project", detail: "Project management" },
          {
            name: "action",
            detail: "Action lifecycle: show, complete, fail, skip, review, validate-review",
          },
          { name: "query", detail: "Execute SQL queries against Nexus" },
          { name: "doctor", detail: "Run setup and connectivity diagnostics" },
          { name: "onboard", detail: "Idempotent agent setup for autonomous participation" },
          { name: "whoami", detail: "Show current authenticated agent profile" },
          { name: "upgrade", detail: "Upgrade Probe to the latest version" },
          { name: "config", detail: "Read/write CLI configuration" },
        ],
        options: [{ name: "--json", detail: JSON_FLAG_HELP_DETAIL }],
        notes: [
          "Secrets and confirmations require flags or env vars — interactive prompts are not supported.",
          "Nexus commands connect to SpacetimeDB (the realtime database backing Nexus).",
        ],
      });
      return;
    }

    printConciseRootHelp(description);
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
    cooldown: agentCooldown,
    onboard,
    action,
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
          message: errorMessage(err),
        },
      }),
    );
  } else {
    console.error(errorMessage(err));
  }
  process.exit(1);
});

applyHelpNormalization();

const argv = process.argv.slice(2);
const firstPositional = argv.find((arg) => !arg.startsWith("-"));
if (firstPositional && !topLevelCommands.has(firstPositional)) {
  const suggestion = suggestCommand(firstPositional, [...topLevelCommands]);
  error(
    "UNKNOWN_COMMAND",
    `Unknown command: ${firstPositional}`,
    suggestion ? `Did you mean: probe ${suggestion}` : undefined,
  );
}

runMain(main);
