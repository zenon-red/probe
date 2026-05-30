import type { HarnessType } from "~/types/config.js";
import { runAcpDoctor } from "./doctor.js";

export type AcpSetupResult = {
  harness: HarnessType;
  fixed: boolean;
  next: string[];
};

export async function runAcpSetup(options: {
  harness: HarnessType;
  fix?: boolean;
}): Promise<AcpSetupResult> {
  const report = await runAcpDoctor({ harness: options.harness });
  const row = report.harnesses[0];
  const next: string[] = [];

  if (!row || row.acpOk) {
    return { harness: options.harness, fixed: true, next: [] };
  }

  for (const issue of row.issues) {
    if (issue.code === "acp_agent_missing" && options.harness === "hermes") {
      next.push("pip install 'hermes-agent[acp]'");
    }
    if (issue.code === "acp_agent_missing" && options.harness === "pi") {
      next.push("npm install -g pi-acp@^0.0.26");
    }
    if (issue.code === "openclaw_gateway_mcp") {
      next.push("Configure OpenClaw Gateway MCP for seti/voize/nexus tools");
    }
  }

  next.push(`probe acp doctor --harness ${options.harness} --json`);

  return {
    harness: options.harness,
    fixed: false,
    next,
  };
}
