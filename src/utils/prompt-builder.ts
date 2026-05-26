import {
  actionCorrelationFlag,
  actionFailCommand,
  actionSkipCommand,
  ACTION_PROMPT_RUN_SKILL,
  ACTION_PROMPT_SECURITY,
} from "./action-prompts.js";
import { successCommandForAction } from "./action-completion.js";

export function buildActionPrompt(
  action: {
    id: bigint | number;
    kind: string;
    skill: string;
    instruction: string;
    route: string;
    targetType?: string | null;
    targetId?: string | null;
    triggerType?: string | null;
  },
  options?: { promptMarkerTemplate?: string },
): string {
  const markerTemplate = options?.promptMarkerTemplate;
  const lines: string[] = [
    actionCorrelationFlag(action.id, markerTemplate),
    `Skill: ${action.skill}`,
    `Kind: ${action.kind}`,
    `Route: ${action.route}`,
    `Target: ${action.targetType ?? "—"} #${action.targetId ?? "—"}`,
    `Trigger: ${action.triggerType ?? "—"}`,
    `Instruction: ${action.instruction}`,
    "",
    ACTION_PROMPT_SECURITY,
    "",
    ACTION_PROMPT_RUN_SKILL,
    `- ${successCommandForAction(action)}`,
    `- ${actionFailCommand(action.id)}`,
    `- ${actionSkipCommand(action.id)}`,
  ];

  return lines.join("\n");
}

export { actionCorrelationFlag } from "./action-prompts.js";
