import { ACTION_PROMPT_RUN_SKILL, ACTION_PROMPT_SECURITY } from "./action-prompts.js";
import { successCommandForAction } from "./action-completion.js";
import { nexusPromptBoundaryParams, wrapNexusPromptBody } from "./nexus-prompt-boundaries.js";
import { DEFAULT_PROMPT_MARKER_TEMPLATE } from "./prompt-marker.js";

export function buildActionPromptAcp(
  action: {
    id: bigint | number;
    kind: string;
    skills: string[];
    instruction: string;
    route: string;
    targetType?: string | null;
    targetId?: string | null;
    triggerType?: string | null;
  },
  options?: {
    promptMarkerTemplate?: string;
    includeShellCompletion?: boolean;
  },
): { text: string; meta: Record<string, string> } {
  const markerTemplate = options?.promptMarkerTemplate ?? DEFAULT_PROMPT_MARKER_TEMPLATE;
  const boundary = nexusPromptBoundaryParams(action.id, action.route, markerTemplate);
  const skillsList = action.skills.join(", ");

  const bodyLines: string[] = [
    `Skills: ${skillsList}`,
    `Kind: ${action.kind}`,
    `Route: ${action.route}`,
    `Target: ${action.targetType ?? "—"} #${action.targetId ?? "—"}`,
    `Trigger: ${action.triggerType ?? "—"}`,
    `Instruction: ${action.instruction}`,
    "",
    ACTION_PROMPT_SECURITY,
  ];

  if (options?.includeShellCompletion) {
    bodyLines.push("", ACTION_PROMPT_RUN_SKILL, `- ${successCommandForAction(action)}`);
  }

  const text = wrapNexusPromptBody(boundary, bodyLines.join("\n"));

  return {
    text,
    meta: {
      "zenon.red/actionId": String(action.id),
      "zenon.red/route": action.route,
      "zenon.red/kind": action.kind,
      "zenon.red/correlationFlag": boundary.correlationFlag,
    },
  };
}
