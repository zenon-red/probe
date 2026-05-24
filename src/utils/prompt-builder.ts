import {
  actionCompleteCommand,
  actionCorrelationFlag,
  actionFailCommand,
  actionReviewCommand,
  actionSkipCommand,
  actionValidateReviewCommand,
  ACTION_PROMPT_RUN_SKILL,
  ACTION_PROMPT_SECURITY,
} from "./action-prompts.js";

export function buildActionPrompt(action: {
  id: bigint | number;
  kind: string;
  skill: string;
  instruction: string;
  route: string;
  targetType?: string | null;
  targetId?: string | null;
  triggerType?: string | null;
}): string {
  const lines: string[] = [
    actionCorrelationFlag(action.id),
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
    `- ${actionCompleteCommand(action.id)}`,
    `- ${actionFailCommand(action.id)}`,
    `- ${actionSkipCommand(action.id)}`,
  ];

  if (action.kind === "ReviewTask") {
    lines.push(`- ${actionReviewCommand(action.id)}`);
  } else if (action.kind === "ValidateReview") {
    lines.push(`- ${actionValidateReviewCommand(action.id)}`);
  }

  return lines.join("\n");
}

export { actionCorrelationFlag } from "./action-prompts.js";
