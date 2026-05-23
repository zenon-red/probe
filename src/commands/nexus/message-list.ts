import type { MessageType as MessageTypeTag } from "~/module_bindings/types.js";
import { type CommandContext, type Message, type ProjectMessage } from "~/utils/context.js";
import { MessageType } from "~/utils/enums.js";
import { error } from "~/utils/output.js";
import { toMicros } from "~/utils/time.js";
import { messageTargetLabel, resolveMessageTarget } from "./message-target.js";

export type MessageKind = "user" | "directive";

type ListedMessage = (Message & { _type: "channel" }) | (ProjectMessage & { _type: "project" });

const matchesContext = (message: Message | ProjectMessage, context?: string): boolean => {
  if (!context) return true;
  const normalized = context.trim();
  if (!normalized) return true;
  return message.id.toString() === normalized || (message.contextId || "") === normalized;
};

const matchesKind = (kind: MessageKind, messageType: MessageTypeTag): boolean =>
  kind === "user" ? MessageType.is.user(messageType) : MessageType.is.directive(messageType);

export function listMessages(
  ctx: CommandContext,
  targetInput: string | undefined,
  kind: MessageKind,
  limit: number,
  contextFilter?: string,
): { messages: ListedMessage[]; count: number; target: string } {
  if (!Number.isFinite(limit) || limit <= 0) {
    error("INVALID_LIMIT", "--limit must be a positive integer");
  }

  const channels = ctx.channels;
  const projects = ctx.projects;

  let messages: ListedMessage[] = [];
  let targetLabel = "all";

  if (targetInput) {
    const target = resolveMessageTarget(targetInput, projects, channels);
    targetLabel = messageTargetLabel(target);

    if (target.kind === "project") {
      const projectMessages = ctx.projectMessages;
      messages = projectMessages
        .filter((m) => m.projectId === target.projectId && matchesKind(kind, m.messageType))
        .map((m) => ({ ...m, _type: "project" as const }));
    } else {
      const channelMessages = ctx.messages;
      messages = channelMessages
        .filter((m) => m.channelId === target.channelId && matchesKind(kind, m.messageType))
        .map((m) => ({ ...m, _type: "channel" as const }));
    }
  } else {
    const channelMessages = ctx.messages;
    const projectMessages = ctx.projectMessages;

    messages = [
      ...channelMessages
        .filter((m) => matchesKind(kind, m.messageType))
        .map((m) => ({ ...m, _type: "channel" as const })),
      ...projectMessages
        .filter((m) => matchesKind(kind, m.messageType))
        .map((m) => ({ ...m, _type: "project" as const })),
    ];
  }

  messages = messages.filter((m) => matchesContext(m, contextFilter));

  messages.sort((a, b) => {
    const aTime = toMicros(a.createdAt);
    const bTime = toMicros(b.createdAt);
    if (aTime < bTime) return 1;
    if (aTime > bTime) return -1;
    return 0;
  });

  messages = messages.slice(0, limit);

  return { messages, count: messages.length, target: targetLabel };
}
