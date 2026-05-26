import {
  actionCompleteCommand,
  actionCorrelationFlag,
  actionFailCommand,
  actionSkipCommand,
  ACTION_PROMPT_RUN_SKILL,
  ACTION_PROMPT_SECURITY,
  executionCompleteCommand,
  proposalCompleteCommand,
  reviewCompleteCommand,
  reviewValidateCommand,
  voteCompleteCommand,
} from "./action-prompts.js";

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

function successCommandForAction(action: {
  id: bigint | number;
  kind: string;
  route: string;
}): string {
  if (action.kind === "ReviewTask") return reviewCompleteCommand(action.id);
  if (action.kind === "ValidateReview") return reviewValidateCommand(action.id);
  if (action.route === "ProposalScout") return proposalCompleteCommand(action.id);
  if (action.route === "Vote") return voteCompleteCommand(action.id);
  if (action.route === "AssignOpenTask" || action.route === "ContinueOwnedTask") {
    return executionCompleteCommand(action.id);
  }
  return actionCompleteCommand(action.id);
}

export { actionCorrelationFlag } from "./action-prompts.js";
