import {
	CommandContext,
	type Channel,
	type Agent,
	type Idea,
	type Message,
	type Task,
} from "~/utils/context.js";
import { AgentRole, IdeaStatus, TaskStatus } from "~/utils/enums.js";
import { toMicros } from "~/utils/time.js";

export const REASON_CODES = {
	REPAIR_WALLET: "REPAIR_WALLET",
	REPAIR_AUTH: "REPAIR_AUTH",
	REPAIR_REGISTRATION: "REPAIR_REGISTRATION",
	REPAIR_NEXUS: "REPAIR_NEXUS",
	REPAIR_EMPTY_SUBSCRIPTION: "REPAIR_EMPTY_SUBSCRIPTION",
	READ_DIRECTIVE: "READ_DIRECTIVE",
	INBOX_MESSAGES: "INBOX_MESSAGES",
	INBOX_FRESHNESS_UNAVAILABLE: "INBOX_FRESHNESS_UNAVAILABLE",
	OLDEST_UNVOTED_IDEA: "OLDEST_UNVOTED_IDEA",
	PROPOSAL_SCOUT_DUE: "PROPOSAL_SCOUT_DUE",
	CONTINUE_TASK: "CONTINUE_TASK",
	CLAIM_TASK: "CLAIM_TASK",
	PROJECT_SETUP: "PROJECT_SETUP",
	CREATE_TASKS: "CREATE_TASKS",
	VALIDATE_REVIEWS: "VALIDATE_REVIEWS",
	REVIEW_DISCOVERY: "REVIEW_DISCOVERY",
	IDLE: "IDLE",
} as const;

export const SKILLS: Record<string, string> = {
	repair: "zr-doctor",
	read_directive: "",
	inbox: "zr-inbox",
	vote: "zr-vote",
	propose: "zr-propose",
	continue_task: "zr-execute",
	claim_task: "zr-claim",
	project_setup: "zr-project-setup",
	create_tasks: "zr-create-tasks",
	validate_reviews: "zr-validate",
	review_discovery: "zr-review-discoveries",
	idle: "",
};

export interface NextAction {
	kind: string;
	target?: { type: string; id: string };
	reason_code: string;
	skill?: string;
}

export function chooseNext(
	ctx: CommandContext,
	agent: Agent,
): NextAction {
	// 0. General directive changed: force next action to read directive
	const channels = ctx.iter<Channel>("channels");
	const generalChannel = channels.find((c) => c.name === "general");
	if (generalChannel) {
		const directives = ctx
			.iter<Message>("messages")
			.filter((m) => m.channelId === generalChannel.id && m.messageType.tag === "Directive")
			.sort((a, b) => {
				const aMicros = toMicros(a.createdAt);
				const bMicros = toMicros(b.createdAt);
				return aMicros < bMicros ? 1 : aMicros > bMicros ? -1 : 0;
			});
		const latestDirective = directives[0];
		if (latestDirective) {
			const priorDirectiveReads = ctx
				.iter<{
					agentId: string;
					kind: { tag: string };
					targetType: string | null;
					targetId: string | null;
					reasonCode: string;
				}>("agent_actions")
				.filter(
					(a) =>
						a.agentId === agent.id &&
						a.kind.tag === "Inbox" &&
						a.reasonCode === REASON_CODES.READ_DIRECTIVE &&
						a.targetType === "directive" &&
						a.targetId === latestDirective.id.toString(),
				);
			if (priorDirectiveReads.length === 0) {
				return {
					kind: "inbox",
					target: { type: "directive", id: latestDirective.id.toString() },
					reason_code: REASON_CODES.READ_DIRECTIVE,
					skill: SKILLS.read_directive,
				};
			}
		}
	}

	// 1. Inbox
	const messages = ctx.iter<Message>("messages");
	const personalChannel = channels.find((c) => c.name === agent.id);
	if (personalChannel) {
		const cutoff =
			(agent.lastHeartbeat
				? toMicros(agent.lastHeartbeat) - BigInt(3600 * 1_000_000)
				: 0n) || 0n;
		const recent = messages
			.filter(
				(m) =>
					m.channelId === personalChannel.id &&
					toMicros(m.createdAt) > cutoff,
			)
			.slice(0, 3);
		if (recent.length > 0) {
			return {
				kind: "inbox",
				target: { type: "message", id: recent[0].id.toString() },
				reason_code: REASON_CODES.INBOX_MESSAGES,
				skill: SKILLS.inbox,
			};
		}
	}

	// 2. Zeno routing
	if (AgentRole.is.zeno(agent.role)) {
		// Vote
		const votes = ctx.iter<{ ideaId: bigint; agentId: string }>("votes");
		const votedIdeaIds = new Set(
			votes.filter((v) => v.agentId === agent.id).map((v) => v.ideaId),
		);
		const pendingIdeas = ctx
			.iter<Idea>("ideas")
			.filter(
				(i) =>
					IdeaStatus.is.voting(i.status) && !votedIdeaIds.has(i.id),
			)
			.sort((a, b) => {
				const aMicros = toMicros(a.createdAt);
				const bMicros = toMicros(b.createdAt);
				return aMicros < bMicros ? -1 : aMicros > bMicros ? 1 : 0;
			});
		if (pendingIdeas.length > 0) {
			return {
				kind: "vote",
				target: { type: "idea", id: pendingIdeas[0].id.toString() },
				reason_code: REASON_CODES.OLDEST_UNVOTED_IDEA,
				skill: SKILLS.vote,
			};
		}

		// Propose
		const pendingCount = ctx
			.iter<Idea>("ideas")
			.filter((i) => IdeaStatus.is.voting(i.status)).length;
		if (pendingCount < 3) {
			return {
				kind: "propose",
				reason_code: REASON_CODES.PROPOSAL_SCOUT_DUE,
				skill: SKILLS.propose,
			};
		}

		// Continue task
		const tasks = ctx.iter<Task>("tasks");
		const owned = tasks.find(
			(t) =>
				t.assignedTo === agent.id &&
				(TaskStatus.is.claimed(t.status) ||
					TaskStatus.is.inProgress(t.status)),
		);
		if (owned) {
			return {
				kind: "continue_task",
				target: { type: "task", id: owned.id.toString() },
				reason_code: REASON_CODES.CONTINUE_TASK,
				skill: SKILLS.continue_task,
			};
		}

		// Claim task
		const ready = tasks
			.filter((t) => TaskStatus.is.open(t.status))
			.sort((a, b) => a.priority - b.priority);
		if (ready.length > 0) {
			return {
				kind: "claim_task",
				target: { type: "task", id: ready[0].id.toString() },
				reason_code: REASON_CODES.CLAIM_TASK,
				skill: SKILLS.claim_task,
			};
		}
	}

	// 3. Zoe routing
	if (AgentRole.is.zoe(agent.role)) {
		// Approved ideas without project
		const approvedIdeas = ctx
			.iter<Idea>("ideas")
			.filter((i) => IdeaStatus.is.approved(i.status))
			.sort((a, b) => {
				const aMicros = toMicros(a.createdAt);
				const bMicros = toMicros(b.createdAt);
				return aMicros < bMicros ? -1 : aMicros > bMicros ? 1 : 0;
			});
		const projects = ctx.iter<{ sourceIdeaId: bigint }>("projects");
		const projectIdeaIds = new Set(projects.map((p) => p.sourceIdeaId));
		const needProject = approvedIdeas.find(
			(i) => !projectIdeaIds.has(i.id),
		);
		if (needProject) {
			return {
				kind: "project_setup",
				target: { type: "idea", id: needProject.id.toString() },
				reason_code: REASON_CODES.PROJECT_SETUP,
				skill: SKILLS.project_setup,
			};
		}

		// Projects ready for task breakdown
		const activeProjects = ctx
			.iter<{ id: bigint; status: { tag: string }; sourceIdeaId: bigint }>(
				"projects",
			)
			.filter((p) => p.status.tag === "Active");
		for (const project of activeProjects) {
			const taskCount = ctx
				.iter<Task>("tasks")
				.filter((t) => t.projectId === project.id).length;
			if (taskCount === 0) {
				return {
					kind: "create_tasks",
					target: { type: "project", id: project.id.toString() },
					reason_code: REASON_CODES.CREATE_TASKS,
					skill: SKILLS.create_tasks,
				};
			}
		}

		// Validate reviews
		const reviewTasks = ctx
			.iter<Task>("tasks")
			.filter(
				(t) =>
					TaskStatus.is.review(t.status) && t.reviewCount > 0,
			)
			.slice(0, 3);
		if (reviewTasks.length > 0) {
			return {
				kind: "validate_reviews",
				target: { type: "task", id: reviewTasks[0].id.toString() },
				reason_code: REASON_CODES.VALIDATE_REVIEWS,
				skill: SKILLS.validate_reviews,
			};
		}

		// Review discovery
		const discoveries = ctx
			.iter<{
				id: bigint;
				status: { tag: string };
			}>("discovered_tasks")
			.filter((d) => d.status.tag === "PendingReview")
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		if (discoveries.length > 0) {
			return {
				kind: "review_discovery",
				target: {
					type: "discovered_task",
					id: discoveries[0].id.toString(),
				},
				reason_code: REASON_CODES.REVIEW_DISCOVERY,
				skill: SKILLS.review_discovery,
			};
		}
	}

	// 4. Idle
	return {
		kind: "idle",
		reason_code: REASON_CODES.IDLE,
		skill: SKILLS.idle,
	};
}
