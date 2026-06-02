import type { ChildProcess } from "node:child_process";
import { runAcpSession, type RunAcpSessionOptions } from "~/acp/run-action.js";
import { buildMcpBundleContext } from "~/mcp/bundle.js";
import { callReducer, type CommandContext } from "~/utils/context.js";
import { resolveSpacetimeArgs } from "~/utils/config.js";
import { enumName } from "~/utils/enums.js";
import { getCachedToken } from "~/utils/token-cache.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { buildActionPromptAcp } from "~/utils/prompt-builder-acp.js";
import { HARNESS_TIMEOUT_SECS } from "~/utils/timeouts.js";
import { loadUserConfig } from "~/utils/user-config.js";
import type { ActionRunTelemetry, AgentRunOutcome } from "~/acp/types.js";
import { resolveRunTokens, type ResolvedRunTokens } from "./session-usage/index.js";
import type { ExecutableAction } from "./executable-action.js";
import type { EventEmitter } from "./events.js";
import { writeActionSidecar, type ActionSidecar } from "./sidecar.js";

const REPORT_FINISH_ATTEMPTS = 5;
const REPORT_FINISH_DELAY_MS = 400;

export type { ExecutableAction } from "./executable-action.js";

export type ActionExecutorDeps = {
  ctx: CommandContext;
  harness: HarnessDetectionResult;
  effectiveWallet: string | null;
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

    const runStartedAt = new Date();

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
    } catch {}

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

    const acpConfig = localConfig.acp;

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

      const { outcome, durationSecs, telemetry: acpTelemetry } = result;

      const resolved = await resolveRunTokens(
        deps.harness.harness,
        action.id,
        runStartedAt,
        acpTelemetry,
        {
          markerTemplate: promptMarkerTemplate,
          dataRoots: acpConfig?.sessionDataRoots,
        },
      );

      if (resolved.tokenMismatch) {
        deps.emit({
          type: "token_mismatch",
          action_id: action.id.toString(),
          acp_input_tokens: acpTelemetry.inputTokens,
          acp_output_tokens: acpTelemetry.outputTokens,
          session_input_tokens: resolved.inputTokens,
          session_output_tokens: resolved.outputTokens,
        });
      }

      if (resolved.tokenSource === "none") {
        deps.emit({
          type: "acp_usage_unavailable",
          action_id: action.id.toString(),
          reason: resolved.sessionReason ?? "no_usage",
        });
        if (resolved.sessionReason) {
          deps.emit({
            type: "harness_usage_extraction_failed",
            action_id: action.id.toString(),
            reason: resolved.sessionReason,
          });
        }
      }

      await reportRunFinished(deps, action.id, outcome, durationSecs, resolved, acpTelemetry);

      const finishedAt = new Date().toISOString();
      if (deps.effectiveWallet) {
        const sidecar: ActionSidecar = {
          actionId: action.id.toString(),
          harness: deps.harness.harness,
          sessionFile: resolved.sessionFile,
          startedAt: runStartedAt.toISOString(),
          finishedAt,
          exitCode: outcome === "Clean" ? 0 : 1,
          tokens: { in: resolved.inputTokens, out: resolved.outputTokens },
          toolCalls:
            acpTelemetry.toolCallsTotal > 0
              ? [{ name: "acp", path: `total=${acpTelemetry.toolCallsTotal}` }]
              : [],
        };
        await writeActionSidecar(deps.effectiveWallet, sidecar, deps.emit);
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

async function reportRunFinished(
  deps: ActionExecutorDeps,
  actionId: bigint,
  outcome: AgentRunOutcome,
  durationSecs: number,
  resolved: ResolvedRunTokens,
  acpTelemetry: ActionRunTelemetry,
): Promise<void> {
  const params = {
    actionId,
    outcome: { tag: outcome },
    durationSecs: BigInt(durationSecs),
    inputTokens: BigInt(resolved.inputTokens),
    outputTokens: BigInt(resolved.outputTokens),
    tokenSource: resolved.tokenSource,
    toolCallsTotal: BigInt(acpTelemetry.toolCallsTotal),
    toolCallsSucceeded: BigInt(acpTelemetry.toolCallsSucceeded),
    toolCallsFailed: BigInt(acpTelemetry.toolCallsFailed),
    nexusToolCalls: BigInt(acpTelemetry.nexusToolCalls),
    nexusToolCallsFailed: BigInt(acpTelemetry.nexusToolCallsFailed),
    mcpTelemetryJson: JSON.stringify(acpTelemetry.mcpServerBreakdown),
  };

  let lastError = "unknown";
  for (let attempt = 1; attempt <= REPORT_FINISH_ATTEMPTS; attempt++) {
    try {
      await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunFinished, params);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < REPORT_FINISH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, REPORT_FINISH_DELAY_MS * attempt));
      }
    }
  }

  deps.emit({
    type: "report_action_run_failed",
    action_id: actionId.toString(),
    error: lastError,
    input_tokens: resolved.inputTokens,
    output_tokens: resolved.outputTokens,
    token_source: resolved.tokenSource,
  });
}
