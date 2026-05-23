import type { MessageType as MessageTypeTag } from "~/module_bindings/types.js";
import { type CommandContext, callReducer } from "~/utils/context.js";
import { MessageType } from "~/utils/enums.js";
import { error, success } from "~/utils/output.js";
import { resolveMessageTarget } from "./message-target.js";

const MAX_MESSAGE_CONTENT_LENGTH = 4000;

type ContentViolation =
  | { type: "length"; length: number; max: number }
  | { type: "control"; sequence: string; position: number };

export type MessageTypePolicy =
  | { mode: "fixed"; messageType: "directive" }
  | { mode: "user"; typeInput?: string };

function escapeForDisplay(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code === 0x1b) {
      out += "\\x1b";
    } else if (code === 0x7f) {
      out += "\\x7f";
    } else if (code < 0x20) {
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      out += char;
    }
  }
  return out;
}

function findControlSequence(content: string): { sequence: string; position: number } | null {
  const patterns = [
    // oxlint-disable-next-line no-control-regex -- intentionally detecting ANSI control bytes
    /\x1B\[[0-?]*[ -/]*[@-~]/g,
    // oxlint-disable-next-line no-control-regex -- intentionally detecting ANSI control bytes
    /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g,
    // oxlint-disable-next-line no-control-regex -- intentionally detecting ANSI control bytes
    /\x1B[@-_]/g,
    // oxlint-disable-next-line no-control-regex -- intentionally detecting control characters
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
  ];

  let earliest: { sequence: string; position: number } | null = null;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (!match || match.index === undefined) continue;
    const hit = { sequence: match[0], position: match.index + 1 };
    if (!earliest || hit.position < earliest.position) {
      earliest = hit;
    }
  }

  return earliest;
}

export function validateMessageContent(content: string, raw: boolean): ContentViolation | null {
  if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    return {
      type: "length",
      length: content.length,
      max: MAX_MESSAGE_CONTENT_LENGTH,
    };
  }

  if (raw) {
    return null;
  }

  const control = findControlSequence(content);
  if (!control) return null;
  return {
    type: "control",
    sequence: escapeForDisplay(control.sequence),
    position: control.position,
  };
}

function validateOrFail(content: string, raw: boolean): void {
  const violation = validateMessageContent(content, raw);
  if (!violation) return;
  if (violation.type === "length") {
    error(
      "MESSAGE_CONTENT_TOO_LONG",
      `Message content length ${violation.length} exceeds max ${violation.max} characters.`,
      "Send a concise plain-text summary or split the content into multiple messages.",
    );
  }
  error(
    "MESSAGE_CONTENT_INVALID",
    `ANSI escape sequence ${violation.sequence} at position ${violation.position}.`,
    "Send a plain-text summary, not raw command output. Use --raw if intentional.",
  );
}

function resolveMessageType(typePolicy: MessageTypePolicy): MessageTypeTag {
  if (typePolicy.mode === "fixed") {
    return MessageType.fromString(typePolicy.messageType);
  }

  const typeStr = (typePolicy.typeInput || "user").toLowerCase();
  if (typeStr === "directive") {
    error(
      "INVALID_TYPE",
      "'directive' is not allowed with 'message send'. Use: probe message directive <target> <content>",
    );
  }
  return MessageType.fromString(typePolicy.typeInput || "user");
}

export async function sendMessage(
  ctx: CommandContext,
  targetInput: string,
  content: string,
  typePolicy: MessageTypePolicy,
  options: { contextId?: string; raw?: boolean } = {},
): Promise<void> {
  validateOrFail(content, !!options.raw);

  const messageType = resolveMessageType(typePolicy);
  const projects = ctx.projects;
  const channels = ctx.channels;
  const target = resolveMessageTarget(targetInput, projects, channels);

  if (target.kind === "project") {
    const projectChannels = ctx.projectChannels;
    const projectChannel = projectChannels.find((pc) => pc.projectId === target.projectId);
    if (!projectChannel) {
      error("PROJECT_CHANNEL_NOT_FOUND", `Project channel for '${targetInput}' not found`);
    }

    await callReducer(ctx, ctx.conn.reducers.sendProjectMessage, {
      projectId: target.projectId,
      content,
      messageType,
      contextId: options.contextId,
    });

    success({
      sent: true,
      projectId: target.projectId.toString(),
      projectName: target.projectName,
      ...(typePolicy.mode === "fixed" ? { messageType: "directive" } : {}),
    });
    return;
  }

  await callReducer(ctx, ctx.conn.reducers.sendMessage, {
    channelId: target.channelId,
    content,
    messageType,
    contextId: options.contextId,
  });

  success({
    sent: true,
    channelId: target.channelId.toString(),
    channelName: target.channelName,
    ...(typePolicy.mode === "fixed" ? { messageType: "directive" } : {}),
  });
}
