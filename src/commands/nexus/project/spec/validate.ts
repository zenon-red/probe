import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { githubRepoDir, parseGithubRepoRef } from "~/utils/nexus-paths.js";
import { commandExists } from "~/utils/system.js";
import { SHELL_TIMEOUT } from "~/utils/timeouts.js";
import { runWithBoundary } from "../shared.js";

type OpenspecValidateTarget = { name: string; type: "change" | "spec" };

export function openspecValidateTargetFromPath(
  specPath: string,
): OpenspecValidateTarget | undefined {
  const changeMatch = specPath.match(/^openspec\/changes\/([^/]+)\//);
  if (changeMatch) {
    return { name: changeMatch[1]!, type: "change" };
  }
  const specMatch = specPath.match(/^openspec\/specs\/([^/]+)\//);
  if (specMatch) {
    return { name: specMatch[1]!, type: "spec" };
  }
  return undefined;
}

function resolveRepoDir(githubRepo: string): string {
  const parsed = parseGithubRepoRef(githubRepo);
  if (!parsed) {
    error("INVALID_GITHUB_REPO", `Could not parse project github repo: ${githubRepo}`);
  }

  const canonical = githubRepoDir(parsed.owner, parsed.repo);
  if (existsSync(canonical)) {
    return canonical;
  }

  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: process.cwd(),
      stdio: "ignore",
      timeout: SHELL_TIMEOUT.SHORT,
    });
    return process.cwd();
  } catch {
    error(
      "REPO_NOT_FOUND",
      `Repository not found at ${canonical}`,
      `Clone ${parsed.owner}/${parsed.repo} or run from that repo`,
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export default defineCommand({
  meta: { name: "validate", description: "Validate OpenSpec at the project spec ref commit" },
  args: {
    id: { type: "positional", name: "id", description: "Project ID", required: true },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (!commandExists("openspec")) {
      error(
        "OPENSPEC_NOT_FOUND",
        "openspec CLI is not installed or not on PATH",
        "Install OpenSpec (https://openspec.dev) to validate project specs",
      );
    }

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: ["SELECT * FROM projects"] }),
      );
      const project = ctx.projects.find((p) => p.id.toString() === args.id);
      if (!project) error("PROJECT_NOT_FOUND", `Project not found: ${args.id}`);

      const specPath = project.specRefPath;
      const commit = project.specRefCommit;
      if (!specPath || !commit) {
        error(
          "SPEC_REF_MISSING",
          "Project has no spec_ref_path or spec_ref_commit",
          "Submit a spec with: probe project spec submit <id> --path ... --commit ... --hash ...",
        );
      }

      const target = openspecValidateTargetFromPath(specPath);
      if (!target) {
        error(
          "SPEC_PATH_UNSUPPORTED",
          `Cannot derive OpenSpec item from path: ${specPath}`,
          "Use openspec/changes/<id>/... or openspec/specs/<capability>/...",
        );
      }

      const repoDir = resolveRepoDir(project.githubRepo);
      try {
        execSync(`git cat-file -e ${shellQuote(`${commit}^{commit}`)}`, {
          cwd: repoDir,
          stdio: "ignore",
          timeout: SHELL_TIMEOUT.MEDIUM,
        });
      } catch {
        error("GIT_COMMIT_NOT_FOUND", `Commit not found in repository: ${commit}`);
      }

      try {
        execSync(`git cat-file -e ${shellQuote(`${commit}:${specPath}`)}`, {
          cwd: repoDir,
          stdio: "ignore",
          timeout: SHELL_TIMEOUT.MEDIUM,
        });
      } catch {
        error("SPEC_PATH_NOT_FOUND", `Path not found at commit: ${specPath}@${commit}`);
      }

      const worktree = mkdtempSync(join(tmpdir(), "probe-spec-validate-"));
      try {
        execSync(`git worktree add --detach ${shellQuote(worktree)} ${shellQuote(commit)}`, {
          cwd: repoDir,
          stdio: "pipe",
          timeout: SHELL_TIMEOUT.LONG,
        });

        try {
          execSync(
            `openspec validate ${shellQuote(target.name)} --type ${target.type} --strict --no-interactive`,
            {
              cwd: worktree,
              encoding: "utf8",
              timeout: SHELL_TIMEOUT.LONG,
            },
          );
        } catch (err) {
          const stderr =
            err && typeof err === "object" && "stderr" in err
              ? String((err as { stderr?: string }).stderr || "").trim()
              : "";
          error(
            "SPEC_VALIDATION_FAILED",
            stderr || errorMessage(err, "OpenSpec validation failed"),
            `Fix format at ${specPath} (commit ${commit})`,
            1,
          );
        }

        success({
          valid: true,
          projectId: args.id,
          specRefPath: specPath,
          specRefCommit: commit,
          openspecItem: target.name,
          openspecType: target.type,
          repoDir,
        });
      } finally {
        try {
          execSync(`git worktree remove --force ${shellQuote(worktree)}`, {
            cwd: repoDir,
            stdio: "ignore",
            timeout: SHELL_TIMEOUT.MEDIUM,
          });
        } catch {}
        rmSync(worktree, { recursive: true, force: true });
      }
    });
  },
});
