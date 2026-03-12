import type {
	AgentRole as AgentRoleType,
	AgentStatus as AgentStatusType,
	IdeaStatus as IdeaStatusType,
	MessageType as MessageTypeType,
	ProjectStatus as ProjectStatusType,
	TaskStatus as TaskStatusType,
	VoteType as VoteTypeType,
} from "~/module_bindings/types.js";

export const TaskStatus = {
	values: [
		"Open",
		"Claimed",
		"InProgress",
		"Review",
		"Completed",
		"Blocked",
		"Archived",
	] as const,

	is: {
		open: (s: TaskStatusType) => s.tag === "Open",
		claimed: (s: TaskStatusType) => s.tag === "Claimed",
		inProgress: (s: TaskStatusType) => s.tag === "InProgress",
		review: (s: TaskStatusType) => s.tag === "Review",
		completed: (s: TaskStatusType) => s.tag === "Completed",
		blocked: (s: TaskStatusType) => s.tag === "Blocked",
		archived: (s: TaskStatusType) => s.tag === "Archived",
		active: (s: TaskStatusType) =>
			["Open", "Claimed", "InProgress", "Review"].includes(s.tag),
		terminal: (s: TaskStatusType) =>
			["Completed", "Blocked", "Archived"].includes(s.tag),
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
		return map[s.toLowerCase().replace(/[_\s]/g, "")] ?? { tag: "Open" };
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
	values: ["Voting", "ApprovedForProject", "Rejected", "Implemented"] as const,

	is: {
		voting: (s: IdeaStatusType) => s.tag === "Voting",
		approved: (s: IdeaStatusType) => s.tag === "ApprovedForProject",
		rejected: (s: IdeaStatusType) => s.tag === "Rejected",
		implemented: (s: IdeaStatusType) => s.tag === "Implemented",
		active: (s: IdeaStatusType) => s.tag === "Voting",
		terminal: (s: IdeaStatusType) =>
			["ApprovedForProject", "Rejected", "Implemented"].includes(s.tag),
	},

	fromString(s: string): IdeaStatusType {
		const map: Record<string, IdeaStatusType> = {
			voting: { tag: "Voting" },
			approved: { tag: "ApprovedForProject" },
			approved_for_project: { tag: "ApprovedForProject" },
			rejected: { tag: "Rejected" },
			implemented: { tag: "Implemented" },
		};
		return map[s.toLowerCase().replace(/[_\s]/g, "")] ?? { tag: "Voting" };
	},

	matches(status: IdeaStatusType, filter: string): boolean {
		const f = filter.toLowerCase().replace(/[_\s]/g, "");
		if (f === "approved") return status.tag === "ApprovedForProject";
		return status.tag.toLowerCase() === f;
	},

	display(status: IdeaStatusType): string {
		if (status.tag === "ApprovedForProject") return "Approved";
		return status.tag;
	},
} as const;

export const VoteType = {
	values: ["Up", "Down", "Veto"] as const,

	is: {
		up: (v: VoteTypeType) => v.tag === "Up",
		down: (v: VoteTypeType) => v.tag === "Down",
		veto: (v: VoteTypeType) => v.tag === "Veto",
		positive: (v: VoteTypeType) => v.tag === "Up",
		negative: (v: VoteTypeType) => ["Down", "Veto"].includes(v.tag),
	},

	fromString(s: string): VoteTypeType {
		const map: Record<string, VoteTypeType> = {
			up: { tag: "Up" },
			down: { tag: "Down" },
			veto: { tag: "Veto" },
		};
		return map[s.toLowerCase()] ?? { tag: "Up" };
	},

	display(v: VoteTypeType): string {
		return v.tag.toLowerCase();
	},
} as const;

export const AgentRole = {
	values: ["Zoe", "Admin", "Zeno"] as const,

	is: {
		zoe: (r: AgentRoleType) => r.tag === "Zoe",
		admin: (r: AgentRoleType) => r.tag === "Admin",
		zeno: (r: AgentRoleType) => r.tag === "Zeno",
		privileged: (r: AgentRoleType) => ["Zoe", "Admin"].includes(r.tag),
	},

	fromString(s: string): AgentRoleType {
		const map: Record<string, AgentRoleType> = {
			zoe: { tag: "Zoe" },
			admin: { tag: "Admin" },
			zeno: { tag: "Zeno" },
		};
		return map[s.toLowerCase()] ?? { tag: "Zeno" };
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
		available: (s: AgentStatusType) =>
			s.tag === "Online" || s.tag === "Working",
	},

	fromString(s: string): AgentStatusType {
		const map: Record<string, AgentStatusType> = {
			online: { tag: "Online" },
			offline: { tag: "Offline" },
			working: { tag: "Working" },
			busy: { tag: "Working" },
		};
		return map[s.toLowerCase()] ?? { tag: "Offline" };
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
		return map[s.toLowerCase()] ?? { tag: "User" };
	},

	display(t: MessageTypeType): string {
		return t.tag.toLowerCase();
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
		return map[normalized] ?? { tag: "Active" };
	},

	matches(status: ProjectStatusType, filter: string): boolean {
		const normalized = filter.toLowerCase().replace(/[_\s]/g, "");
		return status.tag.toLowerCase() === normalized;
	},

	display(status: ProjectStatusType): string {
		return status.tag.toLowerCase();
	},
} as const;
