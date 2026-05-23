import { defineCommand } from "citty";
import { applyJsonMode } from "~/utils/output.js";
import { runAuthenticatedCommand } from "~/utils/reducer-command.js";
import { sendMessage } from "../message-send.js";

const SEND_SUBSCRIBE = [
  "SELECT * FROM channels",
  "SELECT * FROM projects",
  "SELECT * FROM project_channels",
];

export const messageDirectiveCommand = defineCommand({
  meta: { name: "directive", description: "Send a directive to a channel or project" },
  args: {
    target: {
      type: "positional",
      description: "Channel name or project ID",
      required: true,
    },
    content: {
      type: "positional",
      description: "Directive content",
      required: true,
    },
    context: {
      type: "string",
      description: "Thread context ID (message ID or entity ref like task:42)",
    },
    raw: {
      type: "boolean",
      description: "Allow raw control/ANSI sequences in content",
      default: false,
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runAuthenticatedCommand(args, { subscribe: SEND_SUBSCRIBE }, async (ctx) => {
      await sendMessage(
        ctx,
        args.target,
        args.content,
        { mode: "fixed", messageType: "directive" },
        { contextId: args.context, raw: !!args.raw },
      );
    });
  },
});
