import { defineCommand, runCommand } from "citty";
import admin from "./commands/admin/index.js";
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
import versionCmd from "./commands/version.js";
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
  setHelpJsonRequested,
  helpJsonRequested,
  suggestCommand,
} from "./utils/help.js";
import {
  ROOT_HELP_COMMAND_ORDER,
  TOP_LEVEL_COMMAND_DESCRIPTIONS,
  rootHelpDiscoveryJson,
} from "./utils/help-discovery.js";
import { guardNexusDaemonArgv, guardUnknownSubcommand } from "./utils/subcommand.js";
import {
  exitProcess,
  renderBoundaryErrorAndExit,
  renderProbeErrorAndExit,
} from "./utils/boundary.js";
import { configureSdkLogLevel, error } from "./utils/output.js";
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
  "version",
  "onboard",
  "action",
  "genesis",
  "artifact",
  "review",
  "admin",
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
      if (helpJsonRequested()) {
        console.log(JSON.stringify(rootHelpDiscoveryJson(description), null, 2));
        return;
      }
      printHelp({
        command: "probe",
        description,
        usage: [
          "probe <command> [positionals] [options]",
          'probe idea propose --title "Better task scoring" --category planning',
          "probe task claim 42 --wallet agent-wallet",
        ],
        actions: ROOT_HELP_COMMAND_ORDER.map((name) => ({
          name,
          detail: TOP_LEVEL_COMMAND_DESCRIPTIONS[name] ?? name,
        })),
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
    version: versionCmd,
    whoami,
    admin,
  },
});

process.on("unhandledRejection", (err: unknown) => {
  renderBoundaryErrorAndExit(err);
  console.error(err);
  exitProcess(1);
});

const prepareCliArgv = (): string[] => {
  const argv = process.argv.slice(2);
  const normalized = normalizeHelpArgv(argv);
  setForceHelpRequested(normalized.forceHelp);
  setHelpJsonRequested(normalized.forceHelpJson);
  process.argv = [...process.argv.slice(0, 2), ...normalized.argv];
  return normalized.argv;
};

configureSdkLogLevel();

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
  guardNexusDaemonArgv(argv);
} catch (err) {
  renderBoundaryErrorAndExit(err);
  throw err;
}

if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
  console.log(version);
} else {
  runCommand(main, { rawArgs: argv }).catch((err: unknown) => {
    renderBoundaryErrorAndExit(err);
    console.error(err);
    exitProcess(1);
  });
}
