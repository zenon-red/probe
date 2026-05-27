import { homedir } from "node:os";
import { join } from "node:path";

export const GITHUB_HOST = "github.com";

export function nexusRoot(): string {
  return join(homedir(), "nexus");
}

export function githubRepoDir(owner: string, repo: string): string {
  return join(nexusRoot(), GITHUB_HOST, owner, repo);
}

export function forkRepoUrl(agentId: string, repo: string): string {
  return `https://${GITHUB_HOST}/${agentId}/${repo}`;
}

export function parseGithubRepoRef(
  githubRepo: string,
): { owner: string; repo: string } | undefined {
  const value = githubRepo.trim().replace(/\.git$/i, "");
  if (!value) return undefined;

  if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
    const [owner, repo] = value.split("/");
    return { owner, repo };
  }

  const sshMatch = value.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname !== "github.com") return undefined;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return undefined;
      return { owner: parts[0], repo: parts[1] };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function normalizeGitHubRepoUrl(githubRepo: string): string | undefined {
  const parsed = parseGithubRepoRef(githubRepo);
  if (!parsed) return undefined;
  return `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}`;
}

export type TaskRepoContext = {
  target_repo: string;
  repo_owner: string;
  repo_name: string;
  upstream_url: string;
  fork_url: string;
  fork_path: string;
  branch_hint?: string;
};

export function taskRepoContext(options: {
  agentId: string;
  githubRepo: string;
  taskId?: string;
}): TaskRepoContext | undefined {
  const parsed = parseGithubRepoRef(options.githubRepo);
  if (!parsed) return undefined;

  const target_repo = `${parsed.owner}/${parsed.repo}`;
  return {
    target_repo,
    repo_owner: parsed.owner,
    repo_name: parsed.repo,
    upstream_url: `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}`,
    fork_url: forkRepoUrl(options.agentId, parsed.repo),
    fork_path: githubRepoDir(options.agentId, parsed.repo),
    ...(options.taskId ? { branch_hint: `task/${options.taskId}` } : {}),
  };
}
