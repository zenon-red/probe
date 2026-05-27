import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  githubRepoDir,
  GITHUB_HOST,
  parseGithubRepoRef,
  taskRepoContext,
} from "../../src/utils/nexus-paths.js";

describe("nexus-paths", () => {
  it("parses org/repo slugs", () => {
    expect(parseGithubRepoRef("zenon-red/probe")).toEqual({
      owner: "zenon-red",
      repo: "probe",
    });
  });

  it("parses https github urls", () => {
    expect(parseGithubRepoRef("https://github.com/zenon-red/nexus")).toEqual({
      owner: "zenon-red",
      repo: "nexus",
    });
  });

  it("builds fork paths from project repo and agent id", () => {
    const ctx = taskRepoContext({
      agentId: "zr-zoe",
      githubRepo: "zenon-red/probe",
      taskId: "42",
    });
    expect(ctx).toEqual({
      target_repo: "zenon-red/probe",
      repo_owner: "zenon-red",
      repo_name: "probe",
      upstream_url: "https://github.com/zenon-red/probe",
      fork_url: "https://github.com/zr-zoe/probe",
      fork_path: githubRepoDir("zr-zoe", "probe"),
      branch_hint: "task/42",
    });
    expect(ctx?.fork_path).toBe(join(homedir(), "nexus", GITHUB_HOST, "zr-zoe", "probe"));
  });
});
