import type { ChildProcess } from "node:child_process";
import { callReducer, type CommandContext } from "~/utils/context.js";
import { enumName } from "~/utils/enums.js";
import type { HarnessDetectionResult } from "~/utils/harness-detection.js";
import { buildActionPrompt } from "~/utils/prompt-builder.js";
import { HARNESS_TIMEOUT_SECS } from "~/utils/timeouts.js";
import type { EventEmitter } from "./events.js";
import { runHarness, type SpawnRunner } from "./harness-runner.js";

export interface IssuedAction {
  id: number;
  agentId: string;
  kind: unknown;
  skill?: string;
  instruction?: string;
  route?: unknown;
  targetType?: string | null;
  targetId?: string | null;
  triggerType?: string | null;
  triggerId?: string | null;
  status: unknown;
}

export type ActionExecutorDeps = {
  ctx: CommandContext;
  harness: HarnessDetectionResult;
  emit: EventEmitter;
  setRunningHarness: (child: ChildProcess | null) => void;
  setRunningActionId: (id: number | null) => void;
  spawnFn?: SpawnRunner;
};

export function createActionExecutor(
  deps: ActionExecutorDeps,
): (action: IssuedAction) => Promise<void> {
  return async (action: IssuedAction) => {
    deps.setRunningActionId(action.id);

    const actionKind = enumName(action.kind);
    const prompt = buildActionPrompt({
      id: action.id,
      kind: actionKind,
      skill: action.skill || actionKind.toLowerCase(),
      instruction: action.instruction || `Execute ${actionKind}`,
      route: enumName(action.route),
      targetType: action.targetType,
      targetId: action.targetId,
      triggerType: action.triggerType,
    });

    try {
      await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunStarted, {
        actionId: BigInt(action.id),
        harness: deps.harness.harness,
      });
    } catch {
      // non-fatal
    }

    deps.emit({ type: "action_started", action_id: action.id, harness: deps.harness.harness });

    const timeoutSecs = deps.ctx.config.harnessTimeoutSecs ?? HARNESS_TIMEOUT_SECS;
    const { outcome, durationSecs } = await runHarness({
      harness: deps.harness,
      prompt,
      timeoutSecs,
      spawnFn: deps.spawnFn,
      onChild: (child) => {
        deps.setRunningHarness(child);
      },
    });

    deps.setRunningHarness(null);

    try {
      await callReducer(deps.ctx, deps.ctx.conn.reducers.reportActionRunFinished, {
        actionId: BigInt(action.id),
        outcome: { tag: outcome },
        durationSecs: BigInt(durationSecs),
      });
    } catch {
      // non-fatal
    }

    const eventActionId = action.id;
    deps.setRunningActionId(null);

    if (outcome === "Clean") {
      deps.emit({
        type: "action_completed",
        action_id: eventActionId,
        outcome,
        duration_secs: durationSecs,
      });
    } else {
      deps.emit({
        type: "action_failed_infra",
        action_id: eventActionId,
        outcome,
        duration_secs: durationSecs,
      });
    }
  };
}
