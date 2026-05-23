import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { listMessages } from "../message-list.js";

const MESSAGE_SUBSCRIBE = [
  "SELECT * FROM messages",
  "SELECT * FROM channels",
  "SELECT * FROM projects",
  "SELECT * FROM project_channels",
  "SELECT * FROM project_messages",
];

export const messageListCommand = defineCommand({
  meta: { name: "list", description: "List user messages (all, channel, or project)" },
  args: {
    target: {
      type: "positional",
      description: "Channel name or project ID",
      required: false,
    },
    context: {
      type: "string",
      description: "Thread context ID (message ID or entity ref like task:42)",
    },
    limit: { type: "string", description: "Max messages returned", default: "20" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const limit = parseInt(args.limit || "20", 10);

    try {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: MESSAGE_SUBSCRIBE }),
      );
      const result = listMessages(ctx, args.target, "user", limit, args.context);
      success(result);
    } catch (err) {
      failWithConnectionOrUnexpected(errorMessage(err));
    }
  },
});
