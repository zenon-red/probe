import type { AgentAction } from "~/module_bindings/types.js";
import {
  actionCompleteCommand,
  createTasksCompleteCommand,
  discoveryReviewCompleteCommand,
  executionCompleteCommand,
  mergeReadyCompleteCommand,
  projectSetupCompleteCommand,
  proposalCompleteCommand,
  reviewCompleteCommand,
  reviewValidateCommand,
  submitSpecCompleteCommand,
  voteCompleteCommand,
} from "~/utils/action-prompts.js";
import { enumName } from "~/utils/enums.js";

export type ActionCompletionGuide = {
  command: string;
  note?: string;
};

type ActionCompletionPolicy = {
  genericAllowed: boolean;
  guide: (actionId: bigint | number) => ActionCompletionGuide;
};

const executionPolicy: ActionCompletionPolicy = {
  genericAllowed: false,
  guide: (id) => ({ command: executionCompleteCommand(id) }),
};

const ROUTE_COMPLETION_POLICIES: Record<string, ActionCompletionPolicy> = {
  ReviewTask: {
    genericAllowed: false,
    guide: (id) => ({ command: reviewCompleteCommand(id) }),
  },
  ValidateReview: {
    genericAllowed: false,
    guide: (id) => ({ command: reviewValidateCommand(id) }),
  },
  ProposalScout: {
    genericAllowed: false,
    guide: (id) => ({ command: proposalCompleteCommand(id) }),
  },
  Vote: {
    genericAllowed: false,
    guide: (id) => ({ command: voteCompleteCommand(id) }),
  },
  AssignOpenTask: executionPolicy,
  ContinueOwnedTask: executionPolicy,
  ProjectSetup: {
    genericAllowed: false,
    guide: (id) => ({
      command: `probe project create --name "..." --github-repo <org/repo> --source-idea <idea-id> --description "..."`,
      note: `Then: ${projectSetupCompleteCommand(id)}`,
    }),
  },
  SubmitSpec: {
    genericAllowed: false,
    guide: () => ({
      command:
        "probe project spec submit <project-id> --path <spec-path> --commit <sha> --hash <content-hash>",
    }),
  },
  CreateTasks: {
    genericAllowed: false,
    guide: (id) => ({
      command: `probe task create --project <project-id> --title "..." --spec-requirement "<requirement>" --description "..."`,
      note: `Then: ${createTasksCompleteCommand(id)}`,
    }),
  },
  MergeReadyTask: {
    genericAllowed: false,
    guide: (id) => ({ command: mergeReadyCompleteCommand(id) }),
  },
  ReviewDiscovery: {
    genericAllowed: false,
    guide: (id) => ({ command: discoveryReviewCompleteCommand(id) }),
  },
};

export function completionPolicyForRoute(route: string): ActionCompletionPolicy {
  return (
    ROUTE_COMPLETION_POLICIES[route] ?? {
      genericAllowed: true,
      guide: (id) => ({ command: actionCompleteCommand(id) }),
    }
  );
}

export function successCommandForAction(action: {
  id: bigint | number;
  kind?: string;
  route: string;
}): string {
  return completionPolicyForRoute(action.route).guide(action.id).command;
}

export function completionGuideForAction(action: AgentAction): ActionCompletionGuide {
  const route = enumName(action.route);
  if (route === "SubmitSpec" && action.targetId) {
    return {
      command: submitSpecCompleteCommand(action.targetId),
    };
  }
  return completionPolicyForRoute(route).guide(action.id);
}
