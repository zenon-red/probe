import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { runNexusDaemon, nexusDaemonArgs } from "~/daemon/loop.js";

export { nexusDaemonArgs, runNexusDaemon };

export default defineCommand({
  meta: {
    name: "nexus",
    description: "Persistent Nexus daemon — action executor with narrow subscriptions",
  },
  args: nexusDaemonArgs,
  async run({ args }) {
    if (forceHelpRequested()) {
      printHelp({
        command: "probe nexus",
        description:
          "Run persistent Nexus daemon — receives dispatched actions and executes via harness",
        usage: [
          "probe nexus [options]",
          "probe nexus --wallet agent-wallet",
          "probe nexus --wallet agent-wallet --log-file ./logs/nexus-events.jsonl",
          "probe nexus --harness opencode",
        ],
        options: [
          { name: "--wallet", detail: "Wallet for authenticated persistent connection" },
          { name: "--host, --module", detail: "Nexus SpacetimeDB target overrides" },
          {
            name: "--harness",
            detail: "Harness: auto (default), pi, hermes, openclaw, opencode, custom",
          },
          { name: "--log-level", detail: "critical (default), info, or debug" },
          { name: "--log-file", detail: "Optional JSONL file path for daemon events" },
        ],
        notes: [
          "stdout is JSONL only — structured daemon events for agents.",
          "The daemon subscribes to own agent + own issued actions only (narrow subscriptions).",
          "Heartbeat runs every 5 minutes. Actions are executed one at a time.",
        ],
      });
      return;
    }

    await runNexusDaemon(args as Record<string, unknown>);
  },
});
