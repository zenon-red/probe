import type { Channel, Project } from "~/utils/context.js";
import { error } from "~/utils/output.js";

export type MessageTarget =
  | { kind: "project"; projectId: bigint; projectName: string }
  | { kind: "channel"; channelId: bigint; channelName: string };

const PROJECT_PREFIX = "project:";
const CHANNEL_PREFIX = "channel:";

const isNumeric = (str: string): boolean => /^\d+$/.test(str);

type ParsedTarget = { lookup: "project"; key: string } | { lookup: "channel"; key: string };

function parseTargetInput(input: string): ParsedTarget {
  if (input.startsWith(PROJECT_PREFIX)) {
    const key = input.slice(PROJECT_PREFIX.length);
    if (!key) {
      error("INVALID_TARGET", "project: prefix requires a project id");
    }
    return { lookup: "project", key };
  }

  if (input.startsWith(CHANNEL_PREFIX)) {
    const key = input.slice(CHANNEL_PREFIX.length);
    if (!key) {
      error("INVALID_TARGET", "channel: prefix requires a channel name or id");
    }
    return { lookup: "channel", key };
  }

  if (isNumeric(input)) {
    return { lookup: "project", key: input };
  }

  return { lookup: "channel", key: input };
}

function findChannel(channels: Channel[], key: string): Channel | undefined {
  return channels.find((c) => c.name === key || c.id.toString() === key);
}

export function messageTargetLabel(target: MessageTarget): string {
  if (target.kind === "project") {
    return `project:${target.projectName}`;
  }
  return `#${target.channelName}`;
}

export function resolveMessageTarget(
  input: string,
  projects: Project[],
  channels: Channel[],
): MessageTarget {
  const parsed = parseTargetInput(input);

  if (parsed.lookup === "project") {
    const projectId = BigInt(parsed.key);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      const channel = channels.find((c) => c.id.toString() === parsed.key);
      if (channel) {
        error(
          "PROJECT_NOT_FOUND",
          `Project '${parsed.key}' not found`,
          `Use channel:${parsed.key} to target channel "${channel.name}"`,
        );
      }
      error("PROJECT_NOT_FOUND", `Project '${parsed.key}' not found`);
    }
    return { kind: "project", projectId, projectName: project.name };
  }

  const channel = findChannel(channels, parsed.key);
  if (!channel) {
    error(
      "CHANNEL_NOT_FOUND",
      `Channel '${parsed.key}' not found. Available: ${channels.map((c) => c.name).join(", ")}`,
    );
  }
  return { kind: "channel", channelId: channel.id, channelName: channel.name };
}
