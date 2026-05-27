import { defineCommand } from "citty";
import { currentAgentForIdentity } from "~/commands/nexus/agent/shared.js";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { normalizeGitHubRepoUrl, taskRepoContext } from "~/utils/nexus-paths.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

export const taskClaimCommand = defineCommand({
  meta: { name: "claim", description: "Claim a task for your identity" },
  args: {
    id: { type: "positional", description: "Task ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    try {
      let repositoryUrl: string | undefined;
      let contributingUrl: string | undefined;
      let repoContext: Record<string, unknown> | undefined;

      await withAuth(
        commandContextOptions(args, {
          subscribe: ["SELECT * FROM tasks", "SELECT * FROM projects", "SELECT * FROM agents"],
        }),
        async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.claimTask, { taskId: BigInt(args.id) });

          const task = ctx.tasks.find((t) => t.id.toString() === args.id);
          const project = task ? ctx.projects.find((p) => p.id === task.projectId) : undefined;
          const ownAgent = currentAgentForIdentity(ctx);

          if (project?.githubRepo) {
            repositoryUrl = normalizeGitHubRepoUrl(project.githubRepo);
            if (repositoryUrl) {
              contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`;
            }
            if (ownAgent?.id) {
              repoContext = taskRepoContext({
                agentId: ownAgent.id,
                githubRepo: project.githubRepo,
                taskId: args.id,
              });
            }
          }
        },
      );
      success(
        {
          claimed: true,
          taskId: args.id,
          repositoryUrl,
          contributingUrl,
          ...repoContext,
        },
        [`probe task get ${args.id}`],
      );
    } catch (err) {
      error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
    }
  },
});
