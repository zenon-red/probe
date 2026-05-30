import type { HarnessType } from "~/types/config.js";
import { openAcpConnection } from "./connection.js";
import { ProbeAcpClient } from "./client.js";
import { TelemetryCollector } from "./telemetry.js";
import { resolveHarnessAgentLaunch } from "./agents/launch.js";
import { profileForHarness } from "./agents/profiles.js";
import { isChildRunning } from "./spawn.js";

export type AcpIssue = {
  code: string;
  message: string;
  harness: HarnessType;
};

export type AcpReadinessResult = {
  harness: HarnessType;
  acpOk: boolean;
  issues: AcpIssue[];
};

export async function checkHarnessAcpReadiness(
  harness: HarnessType,
  harnessCommand?: string,
): Promise<AcpReadinessResult> {
  const issues: AcpIssue[] = [];
  const profile = profileForHarness(harness);

  if (harness === "openclaw" && profile.openclawGatewayMcp) {
    issues.push({
      code: "openclaw_gateway_mcp",
      message: "OpenClaw does not support per-session mcpServers; configure Gateway MCP",
      harness,
    });
  }

  let launch;
  try {
    launch = resolveHarnessAgentLaunch(harness, harnessCommand);
  } catch (error) {
    issues.push({
      code: "acp_agent_missing",
      message: error instanceof Error ? error.message : String(error),
      harness,
    });
    return { harness, acpOk: false, issues };
  }

  const telemetry = new TelemetryCollector();
  const client = new ProbeAcpClient({ telemetry });

  try {
    const opened = await openAcpConnection(launch.command, launch.args, () => client, {
      cwd: process.cwd(),
    });

    if (isChildRunning(opened.child)) {
      opened.child.kill("SIGTERM");
    }

    const hasBlocking = issues.some(
      (i) => i.code === "acp_agent_missing" || i.code === "acp_init_failed",
    );
    return { harness, acpOk: !hasBlocking, issues };
  } catch (error) {
    issues.push({
      code: "acp_init_failed",
      message: error instanceof Error ? error.message : String(error),
      harness,
    });
    return { harness, acpOk: false, issues };
  }
}
