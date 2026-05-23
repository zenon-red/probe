import { JSON_FLAG_ARG_DESCRIPTION } from "~/utils/help.js";
import { defineSubcommandParent } from "~/utils/subcommand.js";
import agentBio from "./agent/bio.js";
import agentCapabilities from "./agent/capabilities.js";
import agentHeartbeat from "./agent/heartbeat.js";
import agentIdentity from "./agent/identity.js";
import agentList from "./agent/list.js";
import agentMe from "./agent/me.js";
import agentRegister from "./agent/register.js";
import agentSetStatus from "./agent/set-status.js";
import agentStatus from "./agent/status.js";
import agentVoice from "./agent/voice.js";

export default defineSubcommandParent({
  name: "agent",
  description:
    "Agent lifecycle and identity — register, status, set-status, capabilities, me, bio, heartbeat, list, identity, voice",
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: JSON_FLAG_ARG_DESCRIPTION, default: false },
  },
  help: {
    command: "probe agent",
    description: "Agent identity and status",
    usage: [
      "probe agent <subcommand> [positionals] [options]",
      "probe agent register --wallet agent-wallet",
    ],
    actions: [
      { name: "register", detail: "Register an agent identity" },
      { name: "status", detail: "Show agent status" },
      { name: "set-status", detail: "Set agent online/offline/working" },
      { name: "capabilities", detail: "Update agent capabilities" },
      { name: "me", detail: "Show current agent profile" },
      { name: "bio", detail: "Update agent bio" },
      { name: "heartbeat", detail: "Send heartbeat" },
      { name: "list", detail: "List online agents" },
      { name: "identity", detail: "Show agent identity" },
      { name: "voice", detail: "Voice announcement helpers" },
    ],
  },
  subCommands: {
    register: agentRegister,
    status: agentStatus,
    "set-status": agentSetStatus,
    capabilities: agentCapabilities,
    me: agentMe,
    bio: agentBio,
    heartbeat: agentHeartbeat,
    list: agentList,
    identity: agentIdentity,
    voice: agentVoice,
  },
});
