import type { ChildProcess } from "node:child_process";
import { runAcpSession, type RunAcpSessionOptions } from "~/acp/run-action.js";
import { buildMcpBundleContext } from "~/mcp/bundle.js";
import { callReducer, type CommandContext } from "~/utils/context.js";
import { resolveSpacetimeArgs } from "~/utils/config.js";
import { enumName } from "~/utils/enums.js";
import { getCachedToken } from "~/utils/token-cache.js";
import type { AcpConfig } from "~/types/acp-config.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { buildActionPromptAcp } from "~/utils/prompt-builder-acp.js";
import { HARNESS_TIMEOUT_SECS } from "~/utils/timeouts.js";
import { loadUserConfig } from "~/utils/user-config.js";
import type { ExecutableAction } from "./executable-action.js";
import type { EventEmitter } from "./events.js";

export type { ExecutableAction } from "./executable-action.js";

export type ActionExecutorDeps = {
  ctx: CommandContext;
  harness: HarnessDetectionResult;
  emit: EventEmitter;
  setRunningHarness: (child: ChildProcess | null) => void;
  setRunningActionId: (id: bigint | null) => void;
  runAcpSession?: (
    options: RunAcpSessionOptions,
  ) => Promise<Awaited<ReturnType<typeof runAcpSession>>>;
};

export function createActionExecutor(
  deps: ActionExecutorDeps,
): (action: ExecutableAction) => Promise<void> {
  const executeSession = deps.runAcpSession ?? runAcpSession;

  return async (action: ExecutableAction) => {
    deps.setRunningActionId(action.id);

    const actionKind = enumName(action.kind);
    const route = enumName(action.route);
    const localConfig = await loadUserConfig();
    const promptMarkerTemplate =
      localConfig.promptMarkerTemplate ?? deps.ctx.config.promptMarkerTemplate;

    const walletName = deps.ctx.auth?.wallet;
    const { host, module } = resolveSpacetimeArgs({}, deps.ctx.config);
    const tokenRow = walletName ? await getCachedToken(walletName) : null;
    const agent = deps.ctx.agents[0];
    const mcpBundle =
      walletName && tokenRow?.token && agent
        ? buildMcpBundleContext({
            actionId: action.id,
            token: tokenRow.token,
            host,
            module,
            wallet: walletName,
          })
        : undefined;

    if (!mcpBundle) {
      deps.emit({
        type: "nexus_mcp_unavailable",
        action_id: action.id.toString(),
        reason: !walletName
          ? "no_wallet"
          : !tokenRow?.token
            ? "no_cached_token"
            : !agent
              ? "no_agent"
              : "unknown",
      });
    }

    const { text: promptText, meta: promptMeta } = buildActionPromptAcp(
      {
        id: action.id,
        kind: actionKind,
        skills: action.skills?.length ? action.skills : [actionKind.toLowerCase()],
        instruction: action.instruction || `Execute ${actionKind}`,
        route,
        targetType: action.targetType,
        targetId: action.targetId,
        triggerType: action.triggerType,
      },
      {
        promptMarkerTemplate,
        includeShellCompletion: !mcpBundle,
      },
    );

    try {
      await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunStarted, {
        actionId: action.id,
        harness: deps.harness.harness,
      });
    } catch {
      // non-fatal
    }

    deps.emit({
      type: "action_started",
      action_id: action.id.toString(),
      harness: deps.harness.harness,
    });

    const timeoutSecs = deps.ctx.config.harnessTimeoutSecs ?? HARNESS_TIMEOUT_SECS;
    const harnessCommand =
      deps.harness.harness === "custom"
        ? (deps.ctx.config.harnessCommand ?? deps.harness.command)
        : undefined;

    const acpConfig = (localConfig as { acp?: AcpConfig }).acp;

    try {
      const result = await executeSession({
        harness: deps.harness.harness,
        harnessCommand,
        promptText,
        promptMeta,
        cwd: process.cwd(),
        timeoutSecs,
        route,
        agentId: agent?.id,
        acpConfig,
        mcpBundle,
        attachNexusMcp: Boolean(mcpBundle),
        onChild: (child) => {
          deps.setRunningHarness(child);
        },
        onEvent: (event) => {
          deps.emit({ type: String(event.type), ...event });
          if (event.type === "acp_tool_call" || event.type === "acp_nexus_tool_call") {
            void reportProgress(deps, action.id, String(event.type), event).catch(() => {});
          }
        },
      });

      const { outcome, durationSecs, telemetry } = result;

      try {
        await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunFinished, {
          actionId: action.id,
          outcome: { tag: outcome },
          durationSecs: BigInt(durationSecs),
          inputTokens: BigInt(telemetry.inputTokens),
          outputTokens: BigInt(telemetry.outputTokens),
          tokenSource: telemetry.tokenSource,
          toolCallsTotal: BigInt(telemetry.toolCallsTotal),
          toolCallsSucceeded: BigInt(telemetry.toolCallsSucceeded),
          toolCallsFailed: BigInt(telemetry.toolCallsFailed),
          nexusToolCalls: BigInt(telemetry.nexusToolCalls),
          nexusToolCallsFailed: BigInt(telemetry.nexusToolCallsFailed),
          mcpTelemetryJson: JSON.stringify(telemetry.mcpServerBreakdown),
        });
      } catch {
        // non-fatal until bindings regenerated
      }

      if (outcome === "Clean") {
        deps.emit({
          type: "action_completed",
          action_id: action.id.toString(),
          outcome,
          duration_secs: durationSecs,
        });
      } else {
        deps.emit({
          type: "action_failed_infra",
          action_id: action.id.toString(),
          outcome,
          duration_secs: durationSecs,
        });
      }
    } finally {
      deps.setRunningHarness(null);
      deps.setRunningActionId(null);
    }
  };
}

async function reportProgress(
  deps: ActionExecutorDeps,
  actionId: bigint,
  eventCode: string,
  event: Record<string, unknown>,
): Promise<void> {
  const progress = deps.ctx.conn.reducers.reportActionRunProgress;
  if (!progress) {
    return;
  }
  await callReducer(deps.ctx, progress, {
    actionId,
    eventCode,
    note: JSON.stringify(event),
  });
}
