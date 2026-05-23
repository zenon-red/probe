import { defineCommand } from "citty";
import {
  AGENT_SUBSCRIBE,
  callReducer,
  CommandContext,
  commandContextOptions,
  withAuth,
} from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { currentAgentForIdentity, renderAgentBio, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "bio", description: "View or update agent bio" },
  args: {
    text: {
      type: "positional",
      name: "text",
      description: "Bio text (write)",
      required: false,
    },
    set: { type: "string", description: "Bio text (write)" },
    clear: { type: "boolean", description: "Clear bio for authenticated agent" },
    agent: { type: "string", description: "Agent ID for read-only lookup" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const bioFromPositional = args.text?.trim();
    const hasSet = typeof args.set === "string";
    const hasClear = Boolean(args.clear);
    const hasPositionalBio = Boolean(bioFromPositional);
    const targetAgentId = args.agent?.trim();

    if (hasSet && hasClear) {
      error("INVALID_USAGE", "Use either --set or --clear, not both.");
    }
    if (hasSet && hasPositionalBio) {
      error("INVALID_USAGE", "Provide bio text either as positional argument or --set, not both.");
    }
    if (targetAgentId && (hasSet || hasClear || hasPositionalBio)) {
      error(
        "INVALID_USAGE",
        "--agent is read-only. Do not combine with --set, --clear, or positional bio text.",
      );
    }

    const isWrite = hasSet || hasClear || hasPositionalBio;

    await runWithBoundary(async () => {
      if (isWrite) {
        const bio = hasClear ? "" : (hasSet ? args.set : bioFromPositional) || "";
        try {
          await withAuth(
            commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }),
            async (ctx) => {
              await callReducer(ctx, ctx.conn.reducers.updateAgentBio, { bio });
              const myAgent = currentAgentForIdentity(ctx);
              success({
                updated: true,
                agentId: myAgent?.id,
                bio,
              });
            },
          );
        } catch (err) {
          error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
        }
        return;
      }

      if (targetAgentId) {
        await using ctx = await CommandContext.create(
          commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }),
        );
        const agent = ctx.agents.find((a) => a.id === targetAgentId);
        if (!agent) {
          error("AGENT_NOT_FOUND", `Agent not found: ${targetAgentId}`);
        }
        success(renderAgentBio(agent));
        return;
      }

      await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
        const myAgent = currentAgentForIdentity(ctx);
        if (!myAgent) {
          error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");
        }

        success(renderAgentBio(myAgent));
      });
    });
  },
});
