import type { AgentAction } from "~/module_bindings/types.js";
import { DispatchRoute, enumName } from "~/utils/enums.js";

export type ActionCompletionGuide = {
  command: string;
  note?: string;
};

export function completionGuideForAction(action: AgentAction): ActionCompletionGuide {
  const id = action.id.toString();
  const route = enumName(action.route);

  if (DispatchRoute.is.reviewTask(action.route)) {
    return {
      command: `probe review complete ${id} --outcome approved|changes-requested --summary "..." --artifact-kind review --artifact-url <url>`,
    };
  }
  if (DispatchRoute.is.validateReview(action.route)) {
    return {
      command: `probe review validate ${id} --outcome valid|invalid --summary "..." --artifact-kind review_comment --artifact-url <url>`,
    };
  }
  if (route === "ProposalScout") {
    return {
      command: `probe idea propose --action-id ${id} --title "..." --description "..."`,
      note: "Completes the action when the idea is persisted",
    };
  }
  if (route === "Vote") {
    return {
      command: `probe idea vote --action-id ${id} --idea-id <id> --vote-type for|against|abstain`,
      note: "Completes the action when the vote is persisted",
    };
  }
  if (route === "ContinueOwnedTask" || route === "AssignOpenTask") {
    return {
      command: `probe artifact register --action-id ${id} --kind pull_request --url <github-pr-url> --summary "..."`,
      note: "Completes execution actions when the pull request artifact is registered",
    };
  }
  return { command: `probe action complete ${id}` };
}
