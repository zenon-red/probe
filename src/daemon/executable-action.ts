import type { AgentAction } from "~/module_bindings/types.js";
import { enumName } from "~/utils/enums.js";

export type ExecutableAction = {
  readonly id: bigint;
  readonly agentId: string;
  readonly kind: AgentAction["kind"];
  readonly skills: string[];
  readonly instruction: string;
  readonly route: AgentAction["route"];
  readonly targetType: AgentAction["targetType"];
  readonly targetId: AgentAction["targetId"];
  readonly triggerType: string;
};

export function toActionId(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function parseAgentActionRow(row: unknown): AgentAction | null {
  if (!row || typeof row !== "object") return null;
  const action = row as AgentAction;
  if (action.id === undefined || typeof action.agentId !== "string") return null;
  if (action.kind === undefined || action.status === undefined) return null;
  return action;
}

export function toExecutableAction(row: unknown): ExecutableAction | null {
  const action = parseAgentActionRow(row);
  if (!action) return null;
  if (enumName(action.status) !== "Issued") return null;

  return {
    id: toActionId(action.id),
    agentId: action.agentId,
    kind: action.kind,
    skills: action.skills,
    instruction: action.instruction,
    route: action.route,
    targetType: action.targetType,
    targetId: action.targetId,
    triggerType: action.triggerType,
  };
}
