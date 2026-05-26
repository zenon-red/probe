import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseGenesisManifestJson } from "../src/utils/genesis-manifest.js";
import { pickLatestVTag } from "../src/utils/skills-check.js";
import { runSkillsRefCheck } from "../src/utils/skills-ref-release.js";

const strict = process.argv.includes("--strict");

function parseManifestArg(): { skillsSource: string; skillsRef: string } | null {
  const path = process.argv.find((arg) => arg.endsWith(".json") && !arg.startsWith("-"));
  if (!path) {
    return null;
  }
  try {
    const parsed = parseGenesisManifestJson(readFileSync(path, "utf8"));
    return { skillsSource: parsed.skillsSource, skillsRef: parsed.skillsRef };
  } catch (err) {
    console.error(
      `Invalid genesis manifest ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}

function fetchLatestTagViaGh(repo: string): string | null {
  try {
    const out = execFileSync("gh", ["api", `repos/${repo}/tags`, "--paginate", "-q", ".[].name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tags = out.split("\n").filter(Boolean);
    return pickLatestVTag(tags);
  } catch {
    return null;
  }
}

function fetchLatestTagViaGit(repo: string): string | null {
  try {
    const out = execFileSync("git", ["ls-remote", "--tags", `https://github.com/${repo}.git`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tags = out
      .split("\n")
      .map((line) =>
        line
          .split("\t")[1]
          ?.replace(/^refs\/tags\//, "")
          .replace(/\^{}$/, ""),
      )
      .filter((tag): tag is string => Boolean(tag));
    return pickLatestVTag(tags);
  } catch {
    return null;
  }
}

const manifest = parseManifestArg();
if (!manifest) {
  console.error("Usage: check-skills-ref.ts <genesis.json> [--strict]");
  process.exit(2);
}

const { skillsSource, skillsRef } = manifest;
const latestTag = fetchLatestTagViaGh(skillsSource) ?? fetchLatestTagViaGit(skillsSource);
const { exitCode, lines } = runSkillsRefCheck({
  skillsSource,
  expectedRef: skillsRef,
  latestTag,
  strict,
});

for (const line of lines) {
  console.error(line);
}

process.exit(exitCode);
