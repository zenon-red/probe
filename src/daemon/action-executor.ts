import type { ChildProcess } from "node:child_process";
import { callReducer, type CommandContext } from "~/utils/context.js";
import { enumName } from "~/utils/enums.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { buildActionPrompt } from "~/utils/prompt-builder.js";
import { HARNESS_TIMEOUT_SECS } from "~/utils/timeouts.js";
import type { ExecutableAction } from "./executable-action.js";
import type { EventEmitter } from "./events.js";
import { extractUsage } from "./harness-usage/index.js";
import { runHarness, type SpawnRunner } from "./harness-runner.js";
import { loadUserConfig } from "~/utils/user-config.js";

export type { ExecutableAction } from "./executable-action.js";

export type ActionExecutorDeps = {
  ctx: CommandContext;
  harness: HarnessDetectionResult;
  emit: EventEmitter;
  setRunningHarness: (child: ChildProcess | null) => void;
  setRunningActionId: (id: bigint | null) => void;
  spawnFn?: SpawnRunner;
};

export function createActionExecutor(
  deps: ActionExecutorDeps,
): (action: ExecutableAction) => Promise<void> {
  return async (action: ExecutableAction) => {
    deps.setRunningActionId(action.id);

    const actionKind = enumName(action.kind);
    const localConfig = await loadUserConfig();
    const promptMarkerTemplate =
      localConfig.promptMarkerTemplate ?? deps.ctx.config.promptMarkerTemplate;
    const prompt = buildActionPrompt(
      {
        id: action.id,
        kind: actionKind,
        skill: action.skill || actionKind.toLowerCase(),
        instruction: action.instruction || `Execute ${actionKind}`,
        route: enumName(action.route),
        targetType: action.targetType,
        targetId: action.targetId,
        triggerType: action.triggerType,
      },
      { promptMarkerTemplate },
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

    const runStartedAt = new Date();
    const timeoutSecs = deps.ctx.config.harnessTimeoutSecs ?? HARNESS_TIMEOUT_SECS;
    let outcome: Awaited<ReturnType<typeof runHarness>>["outcome"];
    let durationSecs: number;

    try {
      ({ outcome, durationSecs } = await runHarness({
        harness: deps.harness,
        prompt,
        timeoutSecs,
        spawnFn: deps.spawnFn,
        onChild: (child) => {
          deps.setRunningHarness(child);
        },
      }));

      const extraction = extractUsage({
        harness: deps.harness.harness,
        actionId: action.id,
        runStartedAt,
        promptMarkerTemplate,
      });
      if (extraction.debugReason) {
        deps.emit({
          type: "harness_usage_extraction_failed",
          action_id: action.id.toString(),
          harness: deps.harness.harness,
          reason: extraction.debugReason,
        });
      }
      const { inputTokens, outputTokens } = extraction.usage;

      try {
        await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunFinished, {
          actionId: action.id,
          outcome: { tag: outcome },
          durationSecs: BigInt(durationSecs),
          inputTokens: BigInt(inputTokens),
          outputTokens: BigInt(outputTokens),
        });
      } catch {
        // non-fatal
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
