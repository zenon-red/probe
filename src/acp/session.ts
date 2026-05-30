import type { ChildProcess } from "node:child_process";
import type { PromptResponse, StopReason } from "@agentclientprotocol/sdk";
import type { HarnessType } from "~/types/config.js";
import type { AcpConfig } from "~/types/acp-config.js";
import type { McpBundleContext } from "~/mcp/bundle.js";
import { buildSessionMcpServers } from "~/mcp/bundle.js";
import { resolveHarnessAgentLaunch } from "./agents/launch.js";
import { profileForHarness } from "./agents/profiles.js";
import { ProbeAcpClient } from "./client.js";
import { openAcpConnection } from "./connection.js";
import { mapStopReasonToOutcome } from "./outcome.js";
import { resumeOrCreateSession } from "./resume.js";
import { sessionPolicyForRoute } from "./route-session-policy.js";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "./session-store.js";
import { buildAcpAgentEnv, isChildRunning } from "./spawn.js";
import { TelemetryCollector } from "./telemetry.js";
import type { AcpRunResult } from "./types.js";

export type RunAcpSessionOptions = {
  harness: HarnessType;
  harnessCommand?: string;
  promptText: string;
  promptMeta?: Record<string, string>;
  cwd: string;
  timeoutSecs: number;
  route?: string;
  agentId?: string;
  acpConfig?: AcpConfig;
  mcpBundle?: McpBundleContext;
  attachNexusMcp?: boolean;
  onChild?: (child: ChildProcess) => void;
  onEvent?: (event: Record<string, unknown>) => void;
};

export async function runAcpSession(options: RunAcpSessionOptions): Promise<AcpRunResult> {
  const startTime = Date.now();
  const telemetry = new TelemetryCollector();
  let completionReported = false;
  const launch = resolveHarnessAgentLaunch(options.harness, options.harnessCommand);
  const profile = profileForHarness(options.harness);
  const attachNexus =
    options.attachNexusMcp !== false &&
    profile.supportsPerSessionMcp &&
    (options.mcpBundle !== undefined || options.acpConfig?.mcp?.nexus?.enabled !== false);

  const mcpServers =
    attachNexus && options.mcpBundle
      ? buildSessionMcpServers(options.acpConfig, options.mcpBundle)
      : [];

  let child: ChildProcess | undefined;
  let spawnFailed = false;
  let timedOut = false;
  let sessionError: string | undefined;
  let stopReason: StopReason | undefined;

  const onEvent = (event: Record<string, unknown>) => {
    options.onEvent?.(event);
    if (event.type === "acp_nexus_tool_call" && event.ok === true) {
      const tool = String(event.tool ?? "");
      if (
        tool === "nexus_action_complete" ||
        tool === "nexus_action_fail" ||
        tool === "nexus_action_skip"
      ) {
        completionReported = true;
      }
    }
  };

  try {
    const client = new ProbeAcpClient({
      telemetry,
      boundActionId: options.mcpBundle?.actionId,
      onEvent,
    });
    const opened = await openAcpConnection(launch.command, launch.args, () => client, {
      cwd: options.cwd,
      env: buildAcpAgentEnv(),
    });
    child = opened.child;
    options.onChild?.(child);

    const policy = sessionPolicyForRoute(options.route ?? "");
    const stored =
      policy === "persistent" && options.agentId
        ? await loadStoredSession(options.agentId)
        : undefined;

    const sessionInfo = await resumeOrCreateSession({
      connection: opened.connection,
      cwd: options.cwd,
      mcpServers,
      stored,
    });

    telemetry.recordPromptTurn();

    let promptResponse: PromptResponse;
    try {
      promptResponse = await raceWithTimeout(
        opened.connection.prompt({
          sessionId: sessionInfo.sessionId,
          prompt: [{ type: "text", text: options.promptText }],
          _meta: options.promptMeta,
        }),
        options.timeoutSecs,
        async () => {
          timedOut = true;
          await opened.connection.cancel({ sessionId: sessionInfo.sessionId });
        },
      );
    } catch (error) {
      if (timedOut) {
        promptResponse = { stopReason: "cancelled" };
      } else {
        throw error;
      }
    }

    stopReason = promptResponse.stopReason;
    telemetry.setStopReason(stopReason);
    telemetry.recordPromptUsage(promptResponse.usage);

    if (!promptResponse.usage && telemetry.telemetry.tokenSource === "none") {
      options.onEvent?.({ type: "acp_usage_unavailable" });
    }

    if (policy === "persistent" && options.agentId) {
      await saveStoredSession({
        sessionId: sessionInfo.sessionId,
        agentSessionId: stored?.agentSessionId,
        harness: options.harness,
        agentId: options.agentId,
        updatedAt: new Date().toISOString(),
      });
    } else if (options.agentId) {
      await clearStoredSession(options.agentId);
    }

    try {
      await opened.connection.closeSession({ sessionId: sessionInfo.sessionId });
    } catch {
      // best effort
    }
  } catch (error) {
    sessionError = error instanceof Error ? error.message : String(error);
    spawnFailed = true;
    telemetry.setErrorReason(sessionError);
  } finally {
    if (child && isChildRunning(child)) {
      child.kill("SIGTERM");
    }
  }

  let outcome = mapStopReasonToOutcome(stopReason, spawnFailed, timedOut);
  if (attachNexus && !completionReported && outcome === "Clean") {
    outcome = "Signal";
    options.onEvent?.({ type: "action_incomplete", reason: "nexus_completion_missing" });
  }

  options.onEvent?.(telemetry.toSummaryEvent());

  return {
    outcome,
    durationSecs: Math.max(1, Math.round((Date.now() - startTime) / 1000)),
    telemetry: telemetry.telemetry,
    completionReported,
    nexusMcpAttached: attachNexus,
  };
}

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutSecs: number,
  onTimeout: () => Promise<void>,
): Promise<T> {
  if (timeoutSecs <= 0) {
    return promise;
  }

  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.then((value) => {
    if (expired) {
      throw new Error("ACP session timed out");
    }
    return value;
  });

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      void onTimeout().finally(() => reject(new Error("ACP session timed out")));
    }, timeoutSecs * 1000);
  });

  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
