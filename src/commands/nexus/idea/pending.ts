import { defineCommand } from "citty";
import { currentAgentForIdentity } from "~/commands/nexus/agent/shared.js";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { IdeaStatus } from "~/utils/enums.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary, sortIdeasNewest } from "./shared.js";

export default defineCommand({
  meta: { name: "pending", description: "List voting ideas you have not voted on" },
  args: {
    limit: { type: "string", description: "Max ideas returned" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      const limit = args.limit ? parseInt(args.limit, 10) : undefined;

      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        error("INVALID_LIMIT", "--limit must be a positive integer");
      }

      await withAuth(
        commandContextOptions(args, {
          subscribe: ["SELECT * FROM agents", "SELECT * FROM votes", "SELECT * FROM ideas"],
        }),
        async (ctx) => {
          const myAgent = currentAgentForIdentity(ctx);
          if (!myAgent) {
            error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");
          }

          const votedIdeaIds = new Set(
            ctx.votes.filter((v) => v.agentId === myAgent.id).map((v) => v.ideaId),
          );

          let ideas = ctx.ideas
            .filter((i) => IdeaStatus.is.voting(i.status))
            .filter((i) => !votedIdeaIds.has(i.id));

          ideas = sortIdeasNewest(ideas);

          if (limit !== undefined) ideas = ideas.slice(0, limit);

          success({ ideas, count: ideas.length });
        },
      );
    });
  },
});
