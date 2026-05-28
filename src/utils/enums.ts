import type {
  AgentRole as AgentRoleType,
  AgentStatus as AgentStatusType,
  DispatchRoute as DispatchRouteType,
  IdeaStatus as IdeaStatusType,
  MessageType as MessageTypeType,
  ProjectStatus as ProjectStatusType,
  TaskStatus as TaskStatusType,
} from "~/module_bindings/types.js";

export function enumName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag);
  }
  return String(value ?? "—");
}

export function identityHex(value: unknown): string {
  if (value && typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value ?? "");
}

export const TaskStatus = {
  values: ["Open", "Claimed", "InProgress", "Review", "Completed", "Blocked", "Archived"] as const,

  is: {
    open: (s: TaskStatusType) => s.tag === "Open",
    claimed: (s: TaskStatusType) => s.tag === "Claimed",
    inProgress: (s: TaskStatusType) => s.tag === "InProgress",
    review: (s: TaskStatusType) => s.tag === "Review",
    completed: (s: TaskStatusType) => s.tag === "Completed",
    blocked: (s: TaskStatusType) => s.tag === "Blocked",
    archived: (s: TaskStatusType) => s.tag === "Archived",
    active: (s: TaskStatusType) => ["Open", "Claimed", "InProgress", "Review"].includes(s.tag),
    terminal: (s: TaskStatusType) => ["Completed", "Blocked", "Archived"].includes(s.tag),
  },

  fromString(s: string): TaskStatusType {
    const map: Record<string, TaskStatusType> = {
      open: { tag: "Open" },
      claimed: { tag: "Claimed" },
      in_progress: { tag: "InProgress" },
      inprogress: { tag: "InProgress" },
      review: { tag: "Review" },
      completed: { tag: "Completed" },
      merged: { tag: "Completed" },
      blocked: { tag: "Blocked" },
      archived: { tag: "Archived" },
    };
    const result = map[s.toLowerCase().replace(/[_\s]/g, "")];
    if (!result) throw new Error(`Unknown TaskStatus: "${s}"`);
    return result;
  },

  matches(status: TaskStatusType, filter: string): boolean {
    const f = filter.toLowerCase().replace(/[_\s]/g, "");
    if (f === "merged") return status.tag === "Completed";
    return status.tag.toLowerCase() === f;
  },

  display(status: TaskStatusType): string {
    const map: Record<string, string> = { InProgress: "IN PROGRESS" };
    return map[status.tag] ?? status.tag.toUpperCase();
  },
} as const;

export const IdeaStatus = {
  values: [
    "PendingHumanReview",
    "ChangesRequested",
    "Voting",
    "ApprovedForProject",
    "Rejected",
    "Implemented",
  ] as const,

  is: {
    pendingHumanReview: (s: IdeaStatusType) => s.tag === "PendingHumanReview",
    changesRequested: (s: IdeaStatusType) => s.tag === "ChangesRequested",
    voting: (s: IdeaStatusType) => s.tag === "Voting",
    approved: (s: IdeaStatusType) => s.tag === "ApprovedForProject",
    rejected: (s: IdeaStatusType) => s.tag === "Rejected",
    implemented: (s: IdeaStatusType) => s.tag === "Implemented",
    active: (s: IdeaStatusType) =>
      ["PendingHumanReview", "ChangesRequested", "Voting"].includes(s.tag),
    terminal: (s: IdeaStatusType) =>
      ["ApprovedForProject", "Rejected", "Implemented"].includes(s.tag),
  },

  fromString(s: string): IdeaStatusType {
    const map: Record<string, IdeaStatusType> = {
      pending_human_review: { tag: "PendingHumanReview" },
      pendinghumanreview: { tag: "PendingHumanReview" },
      changes_requested: { tag: "ChangesRequested" },
      changesrequested: { tag: "ChangesRequested" },
      voting: { tag: "Voting" },
      approved: { tag: "ApprovedForProject" },
      approved_for_project: { tag: "ApprovedForProject" },
      approvedforproject: { tag: "ApprovedForProject" },
      rejected: { tag: "Rejected" },
      implemented: { tag: "Implemented" },
    };
    const result = map[s.toLowerCase().replace(/[_\s]/g, "")];
    if (!result) throw new Error(`Unknown IdeaStatus: "${s}"`);
    return result;
  },

  matches(status: IdeaStatusType, filter: string): boolean {
    const f = filter.toLowerCase().replace(/[_\s]/g, "");
    if (f === "approved") return status.tag === "ApprovedForProject";
    if (f === "pendinghumanreview" || f === "pending") return status.tag === "PendingHumanReview";
    if (f === "changesrequested" || f === "changes") return status.tag === "ChangesRequested";
    if (f === "voting") return IdeaStatus.is.voting(status);
    return status.tag.toLowerCase() === f;
  },

  display(status: IdeaStatusType): string {
    if (status.tag === "ApprovedForProject") return "Approved";
    if (status.tag === "PendingHumanReview") return "Pending Review";
    if (status.tag === "ChangesRequested") return "Changes Requested";
    return status.tag;
  },
} as const;

export const AgentRole = {
  values: ["Zoe", "Admin", "Zeno", "Human"] as const,

  is: {
    zoe: (r: AgentRoleType) => r.tag === "Zoe",
    admin: (r: AgentRoleType) => r.tag === "Admin",
    zeno: (r: AgentRoleType) => r.tag === "Zeno",
    human: (r: AgentRoleType) => r.tag === "Human",
    privileged: (r: AgentRoleType) => ["Zoe", "Admin"].includes(r.tag),
    agent: (r: AgentRoleType) => ["Zoe", "Admin", "Zeno"].includes(r.tag),
  },

  fromString(s: string): AgentRoleType {
    const map: Record<string, AgentRoleType> = {
      zoe: { tag: "Zoe" },
      admin: { tag: "Admin" },
      zeno: { tag: "Zeno" },
      human: { tag: "Human" },
    };
    const result = map[s.toLowerCase()];
    if (!result) throw new Error(`Unknown AgentRole: "${s}"`);
    return result;
  },

  display(r: AgentRoleType): string {
    return r.tag.toLowerCase();
  },
} as const;

export const AgentStatus = {
  values: ["Online", "Offline", "Working"] as const,

  is: {
    online: (s: AgentStatusType) => s.tag === "Online",
    offline: (s: AgentStatusType) => s.tag === "Offline",
    working: (s: AgentStatusType) => s.tag === "Working",
    available: (s: AgentStatusType) => s.tag === "Online" || s.tag === "Working",
  },

  fromString(s: string): AgentStatusType {
    const map: Record<string, AgentStatusType> = {
      online: { tag: "Online" },
      offline: { tag: "Offline" },
      working: { tag: "Working" },
      busy: { tag: "Working" },
    };
    const result = map[s.toLowerCase()];
    if (!result) throw new Error(`Unknown AgentStatus: "${s}"`);
    return result;
  },

  display(s: AgentStatusType): string {
    return s.tag;
  },
} as const;

export const MessageType = {
  values: ["User", "System", "Directive"] as const,

  is: {
    user: (t: MessageTypeType) => t.tag === "User",
    system: (t: MessageTypeType) => t.tag === "System",
    directive: (t: MessageTypeType) => t.tag === "Directive",
  },

  fromString(s: string): MessageTypeType {
    const map: Record<string, MessageTypeType> = {
      user: { tag: "User" },
      text: { tag: "User" },
      system: { tag: "System" },
      directive: { tag: "Directive" },
    };
    const result = map[s.toLowerCase()];
    if (!result) throw new Error(`Unknown MessageType: "${s}"`);
    return result;
  },

  display(t: MessageTypeType): string {
    return t.tag.toLowerCase();
  },
} as const;

export const DispatchRoute = {
  is: {
    reviewTask: (r: DispatchRouteType | undefined) => r?.tag === "ReviewTask",
    validateReview: (r: DispatchRouteType | undefined) => r?.tag === "ValidateReview",
  },
} as const;

export const ProjectStatus = {
  values: ["Active", "Paused"] as const,

  is: {
    active: (s: ProjectStatusType) => s.tag === "Active",
    paused: (s: ProjectStatusType) => s.tag === "Paused",
  },

  fromString(s: string): ProjectStatusType {
    const normalized = s.toLowerCase().replace(/[_\s]/g, "");
    const map: Record<string, ProjectStatusType> = {
      active: { tag: "Active" },
      paused: { tag: "Paused" },
    };
    const result = map[normalized];
    if (!result) throw new Error(`Unknown ProjectStatus: "${s}"`);
    return result;
  },

  matches(status: ProjectStatusType, filter: string): boolean {
    const normalized = filter.toLowerCase().replace(/[_\s]/g, "");
    return status.tag.toLowerCase() === normalized;
  },

  display(status: ProjectStatusType): string {
    return status.tag.toLowerCase();
  },
} as const;
