import type { MessageType as MessageTypeTag } from "~/module_bindings/types.js";
import {
  type Channel,
  CommandContext,
  callReducer,
  type Message,
  type Project,
  type ProjectMessage,
  withAuth,
} from "~/utils/context.js";
import { MessageType } from "~/utils/enums.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { error, isJsonMode, success } from "~/utils/output.js";
import { formatTimestamp, toMicros } from "~/utils/time.js";
import { toonList } from "~/utils/toon.js";

export interface MessageCommandArgs {
  action?: string;
  target?: string;
  content?: string;
  type?: string;
  context?: string;
  limit?: string;
  wallet?: string;
  host?: string;
  module?: string;
  raw?: boolean;
}

const MAX_MESSAGE_CONTENT_LENGTH = 4000;

type ContentViolation =
  | { type: "length"; length: number; max: number }
  | { type: "control"; sequence: string; position: number };

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

function validateMessageContent(content: string, raw: boolean): ContentViolation | null {
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

const isNumeric = (str: string): boolean => /^\d+$/.test(str);
const matchesContext = (message: Message | ProjectMessage, context?: string): boolean => {
  if (!context) return true;
  const normalized = context.trim();
  if (!normalized) return true;
  return message.id.toString() === normalized || (message.contextId || "") === normalized;
};

const isUserMessage = (messageType: MessageTypeTag): boolean => MessageType.is.user(messageType);
const isDirectiveMessage = (messageType: MessageTypeTag): boolean =>
  MessageType.is.directive(messageType);

export const runMessageAction = async (args: MessageCommandArgs): Promise<void> => {
  const action = args.action;
  if (!action) {
    error("ACTION_REQUIRED", "Message action required");
  }

  try {
    switch (action) {
      case "list": {
        const targetInput = args.target;
        const limit = parseInt(args.limit || "20", 10);
        if (!Number.isFinite(limit) || limit <= 0) {
          error("INVALID_LIMIT", "--limit must be a positive integer");
        }

        await using ctx = await CommandContext.create({
          subscribe: [
            "SELECT * FROM messages",
            "SELECT * FROM channels",
            "SELECT * FROM projects",
            "SELECT * FROM project_channels",
            "SELECT * FROM project_messages",
          ],
        });
        const channels = ctx.iter<Channel>("channels");
        const projects = ctx.iter<Project>("projects");

        let messages: (Message | ProjectMessage)[] = [];
        let targetLabel = "all";

        if (targetInput) {
          if (isNumeric(targetInput)) {
            const projectId = BigInt(targetInput);
            const projectMessages = ctx.iter<ProjectMessage>("project_messages");
            const project = projects.find((p) => p.id === projectId);

            messages = projectMessages
              .filter((m) => m.projectId === projectId && isUserMessage(m.messageType))
              .map((m) => ({ ...m, _type: "project" as const }));
            targetLabel = project ? `project:${project.name}` : `project:${projectId}`;
          } else {
            const channel = channels.find(
              (c) => c.name === targetInput || c.id.toString() === targetInput,
            );
            if (channel) {
              const channelMessages = ctx.iter<Message>("messages");
              messages = channelMessages
                .filter((m) => m.channelId === channel.id && isUserMessage(m.messageType))
                .map((m) => ({ ...m, _type: "channel" as const }));
              targetLabel = `#${channel.name}`;
            }
          }
        } else {
          const channelMessages = ctx.iter<Message>("messages");
          const projectMessages = ctx.iter<ProjectMessage>("project_messages");

          messages = [
            ...channelMessages
              .filter((m) => isUserMessage(m.messageType))
              .map((m) => ({ ...m, _type: "channel" as const })),
            ...projectMessages
              .filter((m) => isUserMessage(m.messageType))
              .map((m) => ({ ...m, _type: "project" as const })),
          ];
        }

        messages = messages.filter((m) => matchesContext(m, args.context));

        messages.sort((a, b) => {
          const aTime = toMicros(a.createdAt);
          const bTime = toMicros(b.createdAt);
          if (aTime < bTime) return 1;
          if (aTime > bTime) return -1;
          return 0;
        });

        messages = messages.slice(0, limit);

        const channelMap = new Map(channels.map((c) => [c.id.toString(), c.name]));
        const projectMap = new Map(projects.map((p) => [p.id.toString(), p.name]));

        success({ messages, count: messages.length, target: targetLabel });
        if (!isJsonMode()) {
          console.log(
            toonList(
              "messages",
              messages.map((m) => {
                const isProject = "_type" in m && m._type === "project";
                const location = isProject
                  ? `project:${projectMap.get((m as ProjectMessage).projectId.toString()) || (m as ProjectMessage).projectId}`
                  : `#${channelMap.get((m as Message).channelId.toString()) || (m as Message).channelId}`;

                return {
                  id: m.id.toString(),
                  location,
                  senderId: m.senderId,
                  content: m.content,
                  messageType: MessageType.display(m.messageType),
                  contextId: m.contextId || null,
                  createdAt: formatTimestamp(m.createdAt),
                };
              }),
            ),
          );
        }
        break;
      }

      case "directives": {
        const targetInput = args.target;
        const limit = parseInt(args.limit || "20", 10);
        if (!Number.isFinite(limit) || limit <= 0) {
          error("INVALID_LIMIT", "--limit must be a positive integer");
        }

        await using ctx = await CommandContext.create({
          subscribe: [
            "SELECT * FROM messages",
            "SELECT * FROM channels",
            "SELECT * FROM projects",
            "SELECT * FROM project_channels",
            "SELECT * FROM project_messages",
          ],
        });
        const channels = ctx.iter<Channel>("channels");
        const projects = ctx.iter<Project>("projects");

        let messages: (Message | ProjectMessage)[] = [];
        let targetLabel = "all";

        if (targetInput) {
          if (isNumeric(targetInput)) {
            const projectId = BigInt(targetInput);
            const projectMessages = ctx.iter<ProjectMessage>("project_messages");
            const project = projects.find((p) => p.id === projectId);

            messages = projectMessages
              .filter((m) => m.projectId === projectId && isDirectiveMessage(m.messageType))
              .map((m) => ({ ...m, _type: "project" as const }));
            targetLabel = project ? `project:${project.name}` : `project:${projectId}`;
          } else {
            const channel = channels.find(
              (c) => c.name === targetInput || c.id.toString() === targetInput,
            );
            if (channel) {
              const channelMessages = ctx.iter<Message>("messages");
              messages = channelMessages
                .filter((m) => m.channelId === channel.id && isDirectiveMessage(m.messageType))
                .map((m) => ({ ...m, _type: "channel" as const }));
              targetLabel = `#${channel.name}`;
            }
          }
        } else {
          const channelMessages = ctx.iter<Message>("messages");
          const projectMessages = ctx.iter<ProjectMessage>("project_messages");

          messages = [
            ...channelMessages
              .filter((m) => isDirectiveMessage(m.messageType))
              .map((m) => ({ ...m, _type: "channel" as const })),
            ...projectMessages
              .filter((m) => isDirectiveMessage(m.messageType))
              .map((m) => ({ ...m, _type: "project" as const })),
          ];
        }

        messages = messages.filter((m) => matchesContext(m, args.context));

        messages.sort((a, b) => {
          const aTime = toMicros(a.createdAt);
          const bTime = toMicros(b.createdAt);
          if (aTime < bTime) return 1;
          if (aTime > bTime) return -1;
          return 0;
        });

        messages = messages.slice(0, limit);

        const channelMap = new Map(channels.map((c) => [c.id.toString(), c.name]));
        const projectMap = new Map(projects.map((p) => [p.id.toString(), p.name]));

        success({ messages, count: messages.length, target: targetLabel });
        if (!isJsonMode()) {
          console.log(
            toonList(
              "directives",
              messages.map((m) => {
                const isProject = "_type" in m && m._type === "project";
                const location = isProject
                  ? `project:${projectMap.get((m as ProjectMessage).projectId.toString()) || (m as ProjectMessage).projectId}`
                  : `#${channelMap.get((m as Message).channelId.toString()) || (m as Message).channelId}`;

                return {
                  id: m.id.toString(),
                  location,
                  senderId: m.senderId,
                  content: m.content,
                  messageType: MessageType.display(m.messageType),
                  contextId: m.contextId || null,
                  createdAt: formatTimestamp(m.createdAt),
                };
              }),
            ),
          );
        }
        break;
      }

      case "directive": {
        const targetInput = args.target;
        const content = args.content;
        if (!targetInput || !content) {
          error(
            "ARGS_REQUIRED",
            "Target and directive content required. Usage: probe message directive <target> <content>",
          );
        }

        validateOrFail(content, !!args.raw);

        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: [
                "SELECT * FROM channels",
                "SELECT * FROM projects",
                "SELECT * FROM project_channels",
              ],
            },
            async (ctx) => {
              if (isNumeric(targetInput)) {
                const projectId = BigInt(targetInput);
                const projects = ctx.iter<Project>("projects");
                const projectChannels = ctx.iter<{ projectId: bigint }>("project_channels");

                const project = projects.find((p) => p.id === projectId);
                if (!project) {
                  error("PROJECT_NOT_FOUND", `Project '${targetInput}' not found`);
                }

                const projectChannel = projectChannels.find((pc) => pc.projectId === projectId);
                if (!projectChannel) {
                  error(
                    "PROJECT_CHANNEL_NOT_FOUND",
                    `Project channel for '${targetInput}' not found`,
                  );
                }

                await callReducer(ctx, ctx.conn.reducers.sendProjectMessage, {
                  projectId,
                  content,
                  messageType: MessageType.fromString("directive"),
                  contextId: args.context,
                });

                success({
                  sent: true,
                  projectId: projectId.toString(),
                  projectName: project.name,
                  messageType: "directive",
                });
                if (!isJsonMode()) {
                  console.log(
                    toonList("directive_sent", [
                      {
                        target: `project:${project.name}`,
                        contextId: args.context || null,
                      },
                    ]),
                  );
                }
              } else {
                const channels = ctx.iter<Channel>("channels");
                const channel = channels.find(
                  (c) => c.name === targetInput || c.id.toString() === targetInput,
                );
                if (!channel) {
                  error(
                    "CHANNEL_NOT_FOUND",
                    `Channel '${targetInput}' not found. Available: ${channels.map((c) => c.name).join(", ")}`,
                  );
                }

                await callReducer(ctx, ctx.conn.reducers.sendMessage, {
                  channelId: channel.id,
                  content,
                  messageType: MessageType.fromString("directive"),
                  contextId: args.context,
                });

                success({
                  sent: true,
                  channelId: channel.id.toString(),
                  channelName: channel.name,
                  messageType: "directive",
                });
                if (!isJsonMode()) {
                  console.log(
                    toonList("directive_sent", [
                      {
                        target: `#${channel.name}`,
                        contextId: args.context || null,
                      },
                    ]),
                  );
                }
              }
            },
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "send": {
        const targetInput = args.target;
        const content = args.content;
        if (!targetInput || !content) {
          error(
            "ARGS_REQUIRED",
            "Target and message content required. Usage: probe message send <target> <content>",
          );
        }

        validateOrFail(content, !!args.raw);

        if ((args.type || "user").toLowerCase() === "directive") {
          error(
            "INVALID_TYPE",
            "'directive' is not allowed with 'message send'. Use: probe message directive <target> <content>",
          );
        }

        try {
          await withAuth(
            {
              wallet: args.wallet,
              subscribe: [
                "SELECT * FROM channels",
                "SELECT * FROM projects",
                "SELECT * FROM project_channels",
              ],
            },
            async (ctx) => {
              if (isNumeric(targetInput)) {
                const projectId = BigInt(targetInput);
                const projects = ctx.iter<Project>("projects");
                const projectChannels = ctx.iter<{ projectId: bigint }>("project_channels");

                const project = projects.find((p) => p.id === projectId);
                if (!project) {
                  error("PROJECT_NOT_FOUND", `Project '${targetInput}' not found`);
                }

                const projectChannel = projectChannels.find((pc) => pc.projectId === projectId);
                if (!projectChannel) {
                  error(
                    "PROJECT_CHANNEL_NOT_FOUND",
                    `Project channel for '${targetInput}' not found`,
                  );
                }

                await callReducer(ctx, ctx.conn.reducers.sendProjectMessage, {
                  projectId,
                  content,
                  messageType: MessageType.fromString(args.type || "user"),
                  contextId: args.context,
                });

                success({
                  sent: true,
                  projectId: projectId.toString(),
                  projectName: project.name,
                });
                if (!isJsonMode()) {
                  console.log(
                    toonList("message_sent", [
                      {
                        target: `project:${project.name}`,
                        messageType: args.type || "user",
                        contextId: args.context || null,
                      },
                    ]),
                  );
                }
              } else {
                const channels = ctx.iter<Channel>("channels");
                const channel = channels.find(
                  (c) => c.name === targetInput || c.id.toString() === targetInput,
                );
                if (!channel) {
                  error(
                    "CHANNEL_NOT_FOUND",
                    `Channel '${targetInput}' not found. Available: ${channels.map((c) => c.name).join(", ")}`,
                  );
                }

                await callReducer(ctx, ctx.conn.reducers.sendMessage, {
                  channelId: channel.id,
                  content,
                  messageType: MessageType.fromString(args.type || "user"),
                  contextId: args.context,
                });

                success({
                  sent: true,
                  channelId: channel.id.toString(),
                  channelName: channel.name,
                });
                if (!isJsonMode()) {
                  console.log(
                    toonList("message_sent", [
                      {
                        target: `#${channel.name}`,
                        messageType: args.type || "user",
                        contextId: args.context || null,
                      },
                    ]),
                  );
                }
              }
            },
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        break;
      }

      case "channels": {
        await using ctx = await CommandContext.create({});
        const channels = ctx.iter<Channel>("channels");
        const projects = ctx.iter<Project>("projects");
        const projectChannels = ctx.iter<{ projectId: bigint }>("project_channels");

        const projectChannelSet = new Set(projectChannels.map((pc) => pc.projectId.toString()));
        const projectsWithChannels = projects.filter((p) => projectChannelSet.has(p.id.toString()));

        success({
          channels,
          projects: projectsWithChannels,
          channelCount: channels.length,
          projectCount: projectsWithChannels.length,
        });
        if (!isJsonMode()) {
          console.log(
            toonList(
              "channels",
              channels.map((c) => ({
                id: c.id.toString(),
                name: c.name,
                createdBy: c.createdBy,
              })),
            ),
          );
          console.log(
            toonList(
              "projects",
              projectsWithChannels.map((p) => ({
                id: p.id.toString(),
                name: p.name,
                repo: p.githubRepo,
              })),
            ),
          );
        }
        break;
      }

      default:
        error(
          "INVALID_ACTION",
          `Invalid action: ${action}`,
          "Use: list, send, directive, directives, channels",
        );
    }
  } catch (err) {
    const message = errorMessage(err);
    failWithConnectionOrUnexpected(message);
  }
};
