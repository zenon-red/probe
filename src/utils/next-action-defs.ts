import type { NextAction } from "~/utils/next-router.js";

export interface NextActionDef {
  taskInstruction: string;
  maxActions: number;
}

export const NEXT_ACTION_DEFS: Record<string, NextActionDef> = {
  repair: {
    taskInstruction:
      "Run probe doctor and resolve the reported blocker before continuing. For more information, load and fully read the zr-doctor skill.",
    maxActions: 1,
  },
  inbox: {
    taskInstruction: "Load and fully read the zr-inbox skill before processing the inbox target.",
    maxActions: 1,
  },
  vote: {
    taskInstruction:
      "Load and fully read the zr-vote skill before submitting a decision for the target idea.",
    maxActions: 1,
  },
  propose: {
    taskInstruction:
      "Load and fully read the zr-propose skill before submitting a concrete proposal.",
    maxActions: 1,
  },
  claim_task: {
    taskInstruction:
      "Load and fully read the zr-claim skill before claiming one suitable open task.",
    maxActions: 1,
  },
  continue_task: {
    taskInstruction:
      "Load and fully read the zr-execute skill before continuing work on the target task.",
    maxActions: 1,
  },
  project_setup: {
    taskInstruction:
      "Load and fully read the zr-project-setup skill before creating one project scaffold for the target idea.",
    maxActions: 1,
  },
  create_tasks: {
    taskInstruction:
      "Load and fully read the zr-create-tasks skill before creating a bounded task set for the target project.",
    maxActions: 1,
  },
  validate_reviews: {
    taskInstruction:
      "Load and fully read the zr-validate skill before reviewing the target completed task.",
    maxActions: 1,
  },
  review_discovery: {
    taskInstruction:
      "Load and fully read the zr-review-discoveries skill before addressing the target discovered task.",
    maxActions: 1,
  },
  idle: {
    taskInstruction: "No pending work. End this wake cleanly.",
    maxActions: 1,
  },
};

const DEFAULT_ACTION_DEF: NextActionDef = {
  taskInstruction: "Complete the targeted action using the attached skill and context.",
  maxActions: 1,
};

export function getNextActionDef(kind: string): NextActionDef {
  return NEXT_ACTION_DEFS[kind] ?? DEFAULT_ACTION_DEF;
}

export function buildContextCommands(action: NextAction, agentId: string): string[] {
  const target = action.target;
  if (!target) return [];

  if (target.type === "idea") {
    return [`probe idea get ${target.id}`, "probe idea dimensions"];
  }
  if (target.type === "task") {
    return [`probe task get ${target.id}`];
  }
  if (target.type === "message") {
    return [`probe message list ${agentId} --limit 10`];
  }
  if (target.type === "directive") {
    return ["probe message directives general --limit 1"];
  }
  if (target.type === "project") {
    return [`probe project get ${target.id}`];
  }
  if (target.type === "discovered_task") {
    return [`probe discover get ${target.id}`];
  }

  return [];
}
