import { defineSubcommandParent } from "~/utils/subcommand.js";
import { messageChannelsCommand } from "./message/channels.js";
import { messageDirectiveCommand } from "./message/directive.js";
import { messageDirectivesCommand } from "./message/directives.js";
import { messageListCommand } from "./message/list.js";
import { messageSendCommand } from "./message/send.js";

export default defineSubcommandParent({
  name: "message",
  description: "Channel and project messaging",
  help: {
    command: "probe message",
    description: "Channel and project messaging",
    usage: [
      "probe message <subcommand> [positionals] [options]",
      "probe message list general",
      'probe message send general "hello"',
    ],
    actions: [
      { name: "list <target>", detail: "List messages for a project or channel" },
      { name: "directives <target>", detail: "List directive messages" },
      { name: "send <target> <content>", detail: "Send a user message" },
      { name: "directive <target> <content>", detail: "Send a directive message" },
      { name: "channels", detail: "List channels and project channels" },
    ],
  },
  subCommands: {
    list: messageListCommand,
    directives: messageDirectivesCommand,
    send: messageSendCommand,
    directive: messageDirectiveCommand,
    channels: messageChannelsCommand,
  },
});
