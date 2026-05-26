import { defineCommand } from "citty";
import { currentAgentForIdentity } from "~/commands/nexus/agent/shared.js";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runWithBoundary, sortIdeasNewest } from "./shared.js";

export default defineCommand({
  meta: { name: "propose", description: "Propose a new idea" },
  args: {
    title: { type: "string", description: "Idea title", required: true },
    description: { type: "string", description: "Idea description", required: true },
    category: { type: "string", description: "Category (default: general)" },
    "action-id": { type: "string", description: "Dispatch action ID (proposal_scout)" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const title = String(args.title || "").trim();
    if (!title) error("ARGS_REQUIRED", "Title required");
    const description = String(args.description || "").trim();
    if (!description) {
      error("DESCRIPTION_REQUIRED", "Description required and cannot be empty");
    }
    const category = String(args.category || "general");
    const actionIdRaw = args["action-id"] ? String(args["action-id"]).trim() : "";

    await runWithBoundary(async () => {
      let published: ReturnType<typeof sortIdeasNewest>[number] | undefined;

      try {
        await withAuth(
          commandContextOptions(args, {
            subscribe: [
              "SELECT * FROM agents",
              "SELECT * FROM ideas",
              "SELECT * FROM agent_actions",
            ],
          }),
          async (ctx) => {
            const myAgent = currentAgentForIdentity(ctx);

            if (actionIdRaw) {
              const { parseActionId } = await import("~/utils/action-id.js");
              const actionId = parseActionId(actionIdRaw);
              await callReducer(ctx, ctx.conn.reducers.proposeIdeaForAction, {
                actionId,
                title,
                description,
                category,
              });
              published = sortIdeasNewest(ctx.ideas).find(
                (idea) =>
                  idea.title === title &&
                  idea.category === category &&
                  idea.description === description &&
                  (!myAgent || idea.createdBy === myAgent.id),
              );
              success({
                proposed: true,
                action_id: actionId.toString(),
                idea: published
                  ? { id: published.id.toString(), title: published.title }
                  : { title },
              });
              return;
            }

            await callReducer(ctx, ctx.conn.reducers.proposeIdea, {
              title,
              description,
              category,
            });

            published = sortIdeasNewest(ctx.ideas).find(
              (idea) =>
                idea.title === title &&
                idea.category === category &&
                idea.description === description &&
                (!myAgent || idea.createdBy === myAgent.id),
            );
          },
        );
        success({
          proposed: true,
          status: "PendingHumanReview",
          hint: "Idea requires human review before voting",
          idea: published
            ? {
                id: published.id.toString(),
                title: published.title,
                category: published.category,
                descriptionLength: published.description.length,
              }
            : {
                title,
                category,
                descriptionLength: description.length,
              },
        });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
