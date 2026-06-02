import { defineCommand } from "citty";
import { forceHelpRequested, helpJsonRequested, printHelp, printHelpJson } from "~/utils/help.js";
import runCommand from "./run.js";
import statusCommand from "./status.js";
import tuiCommand, { runNexusTui } from "./tui.js";

const nexusHelp = {
  command: "probe nexus",
  description: "Nexus daemon and auditor status",
  usage: [
    "probe nexus run [options]",
    "probe nexus tui --wallet <name>",
    "probe nexus status --wallet <name> [--format json]",
    "probe nexus --wallet <name>",
  ],
  actions: [
    { name: "run", detail: "Persistent daemon; owns action execution" },
    { name: "tui", detail: "Attach live TUI to an existing daemon" },
    { name: "status", detail: "Bounded status query over audit JSONL + sidecars" },
  ],
  notes: [
    "Bare `probe nexus` attaches to a running daemon when possible; otherwise it starts one.",
    "Use `probe nexus status` for agent auditors — not top-level `probe status`.",
  ],
};

export default defineCommand({
  meta: {
    name: "nexus",
    description: "Nexus daemon and auditor status",
  },
  subCommands: {
    run: runCommand,
    tui: tuiCommand,
    status: statusCommand,
  },
  async run(ctx) {
    const positionals = (ctx.args._ as string[] | undefined) ?? [];
    const sub = positionals.find((t) => t === "run" || t === "tui" || t === "status");
    if (sub) return;

    if (forceHelpRequested()) {
      if (helpJsonRequested()) {
        printHelpJson(nexusHelp);
      } else {
        printHelp(nexusHelp);
      }
      return;
    }

    if (
      process.stderr.isTTY &&
      (await runNexusTui(ctx.args as Record<string, unknown>, { failIfMissing: false }))
    ) {
      return;
    }

    return runCommand.run?.(ctx as never);
  },
});
