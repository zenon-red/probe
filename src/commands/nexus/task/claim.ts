import { defineCommand } from "citty";
import { callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

function normalizeGitHubRepoUrl(githubRepo: string): string | undefined {
  const value = githubRepo.trim().replace(/\.git$/i, "");
  if (!value) return undefined;

  if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
    return `https://github.com/${value}`;
  }

  const sshMatch = value.match(/^git@github\.com:([\w.-]+\/[\w.-]+)$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname !== "github.com") return undefined;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return undefined;
      return `https://github.com/${parts[0]}/${parts[1]}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

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

      await withAuth(
        commandContextOptions(args, {
          subscribe: ["SELECT * FROM tasks", "SELECT * FROM projects"],
        }),
        async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.claimTask, { taskId: BigInt(args.id) });

          const task = ctx.tasks.find((t) => t.id.toString() === args.id);
          const project = task ? ctx.projects.find((p) => p.id === task.projectId) : undefined;

          if (project?.githubRepo) {
            repositoryUrl = normalizeGitHubRepoUrl(project.githubRepo);
            if (repositoryUrl) {
              contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`;
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
        },
        [`probe task get ${args.id}`],
      );
    } catch (err) {
      error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
    }
  },
});
