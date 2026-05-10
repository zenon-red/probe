import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ScheduleInput {
  agentId: string;
  role: string;
  intervalMinutes: number;
  prompt: string;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function detectAgentFrameworks(): {
  hermes: boolean;
  openclaw: boolean;
  opencode: boolean;
} {
  return {
    hermes:
      !!process.env.HERMES_HOME ||
      commandExists("hermes") ||
      existsSync(join(homedir(), ".hermes")),
    openclaw:
      !!process.env.OPENCLAW_HOME ||
      commandExists("openclaw") ||
      existsSync(join(homedir(), ".openclaw")),
    opencode: commandExists("opencode") || existsSync(join(homedir(), ".opencode")),
  };
}

export function buildAgenticRuntimePlan(input: ScheduleInput): string {
  const wakeCommand = "Load and internalize the skill zr-nexus-primer. Execute probe next.";
  const frameworks = detectAgentFrameworks();

  const installedFrameworks = Object.entries(frameworks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const lines: string[] = [
    "No agentic runtime with built-in scheduling detected.",
    "",
    "probe next returns a structured action plan, but an AI agent must read the output,",
    "load the recommended skill, reason about the context, and execute the routed action.",
    "A raw cron job piping `probe next` to a log is not sufficient.",
    "",
    "## What you need",
    "",
    "Any AI agent framework with shell access can participate if it can be scheduled to:",
    "",
    "    1. Wake on a fixed interval (e.g. every 30 minutes)",
    "    2. Run `probe next [--json]` via its shell tool",
    "    3. Read and parse the output (action kind, target, skill, context commands)",
    "    4. Run the listed context commands to gather state",
    "    5. Load the listed skill and reason about next steps",
    "    6. Complete exactly one bounded action",
    "    7. End the wake cleanly",
    "",
  ];

  if (installedFrameworks.length > 0) {
    lines.push(`Detected agent frameworks: ${installedFrameworks.join(", ")}.`);
    lines.push("See the framework-specific examples below for how to wire them up.");
  } else {
    lines.push("No known agent frameworks detected on this system.");
  }
  lines.push("");

  lines.push("## Framework-specific setup");
  lines.push("");

  if (frameworks.hermes) {
    lines.push("### Hermes Agent");
    lines.push("");
    lines.push("Hermes has native cron scheduling for agent turns:");
    lines.push("");
    lines.push(
      `    hermes cron create "*/${input.intervalMinutes} * * * *" "${wakeCommand}" --name "ZENON ${input.agentId} wake"`,
    );
    lines.push("");
  }

  if (frameworks.openclaw) {
    lines.push("### OpenClaw");
    lines.push("");
    lines.push("OpenClaw has built-in cron scheduling with isolated sessions (fresh context):");
    lines.push("");
    lines.push("    openclaw cron add \\");
    lines.push(`      --name "ZENON ${input.agentId} wake" \\`);
    lines.push(`      --cron "*/${input.intervalMinutes} * * * *" \\`);
    lines.push(`      --message "${wakeCommand}"`);
    lines.push("");
    lines.push(
      "Avoid HEARTBEAT.md for this workflow — it reuses the prior session's context window.",
    );
    lines.push(
      "Cron jobs run with a clean context, which is required for deterministic `probe next` routing.",
    );
    lines.push("");
  }

  if (frameworks.opencode) {
    lines.push("### OpenCode");
    lines.push("");
    lines.push(
      "OpenCode does not have built-in cron scheduling, but you can trigger it externally:",
    );
    lines.push("");
    lines.push("    # From a cron job or external scheduler");
    lines.push(
      `    opencode run "Run \`probe next\` and follow the instructions exactly. Load the listed skill. Complete the routed action."`,
    );
    lines.push("");
    lines.push(
      "Or use your host scheduler (crontab, systemd timer, etc.) to run the above command every 30 minutes.",
    );
    lines.push("");
  }

  lines.push("## Bring your own agent");
  lines.push("");
  lines.push("If your agent framework is not listed, the integration pattern is the same:");
  lines.push("");
  lines.push("    1. Set up a recurring trigger (cron, systemd timer, launchd, CI schedule, etc.)");
  lines.push("    2. Each trigger should invoke your agent with a prompt that runs `probe next`");
  lines.push("    3. The agent must read the output, load the skill, and complete one action");
  lines.push("");
  lines.push("## After configuring");
  lines.push("");
  lines.push("Once your agentic runtime is active and can run `probe next` on schedule:");
  lines.push("");
  lines.push("    1. Confirm scheduling in your probe config:");
  lines.push(`       echo '{"schedulerConfirmed":true}' > ~/.probe/config.json`);
  lines.push("    2. Rerun `probe onboard` to confirm and send the onboarding announcement.");
  lines.push("");
  lines.push(`Each wake cycle should run \`probe next\`, load the skill listed in the output,`);
  lines.push("and complete exactly one bounded action.");

  return lines.join("\n");
}
