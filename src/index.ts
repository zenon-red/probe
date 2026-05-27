import { defineCommand, runCommand } from "citty";
import auth from "./commands/auth/index.js";
import login from "./commands/login.js";
import config from "./commands/config/index.js";
import doctor from "./commands/doctor.js";
import action from "./commands/action.js";
import agentCooldown from "./commands/agent-cooldown.js";
import onboard from "./commands/onboard.js";
import genesis from "./commands/genesis/index.js";
import artifact from "./commands/artifact/index.js";
import review from "./commands/review/index.js";
import agent from "./commands/nexus/agent.js";
import discover from "./commands/nexus/discover.js";
import idea from "./commands/nexus/idea.js";
import message from "./commands/nexus/message.js";
import project from "./commands/nexus/project.js";
import task from "./commands/nexus/task.js";
import nexusDaemon from "./commands/nexus-daemon.js";
import query from "./commands/query.js";
import sign from "./commands/sign.js";
import token from "./commands/token/index.js";
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
import { guardUnknownSubcommand } from "./utils/subcommand.js";
import { exitProcess, renderProbeErrorAndExit } from "./utils/boundary.js";
import { error } from "./utils/output.js";
import { isProbeError } from "./utils/errors.js";
import { probeDescription, probeVersion } from "./probe-version.js";

const topLevelCommands = new Set([
  "wallet",
  "login",
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
  "genesis",
  "artifact",
  "review",
]);

const version = probeVersion();
const description = probeDescription();

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
          { name: "login", detail: "Authenticate wallet and cache token" },
          { name: "auth", detail: "Inspect cached authentication status" },
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
            detail: "Action lifecycle: show, complete, fail, skip",
          },
          { name: "artifact", detail: "Register and list action artifacts" },
          { name: "review", detail: "Complete review and validation actions" },
          { name: "query", detail: "Execute SQL queries against Nexus" },
          { name: "doctor", detail: "Run setup and connectivity diagnostics" },
          { name: "onboard", detail: "Idempotent agent setup for autonomous participation" },
          { name: "genesis", detail: "Apply and sync org/environment Genesis manifest" },
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
    login,
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
    genesis,
    artifact,
    review,
    action,
    upgrade,
    whoami,
  },
});

process.on("unhandledRejection", (err: unknown) => {
  if (isProbeError(err)) {
    renderProbeErrorAndExit(err);
  }
  console.error(err);
  exitProcess(1);
});

const prepareCliArgv = (): string[] => {
  const argv = process.argv.slice(2);
  const normalized = normalizeHelpArgv(argv);
  setForceHelpRequested(normalized.forceHelp);
  process.argv = [...process.argv.slice(0, 2), ...normalized.argv];
  return normalized.argv;
};

const argv = prepareCliArgv();

const firstPositional = argv.find((arg) => !arg.startsWith("-"));
if (firstPositional && !topLevelCommands.has(firstPositional)) {
  const suggestion = suggestCommand(firstPositional, [...topLevelCommands]);
  try {
    error(
      "UNKNOWN_COMMAND",
      `Unknown command: ${firstPositional}`,
      suggestion ? `Did you mean: probe ${suggestion}` : undefined,
    );
  } catch (err) {
    if (isProbeError(err)) {
      renderProbeErrorAndExit(err);
    }
    throw err;
  }
}

try {
  guardUnknownSubcommand(argv);
} catch (err) {
  if (isProbeError(err)) {
    renderProbeErrorAndExit(err);
  }
  throw err;
}

if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
  console.log(version);
} else {
  runCommand(main, { rawArgs: argv }).catch((err: unknown) => {
    if (isProbeError(err)) {
      renderProbeErrorAndExit(err);
    }
    console.error(err);
    exitProcess(1);
  });
}
