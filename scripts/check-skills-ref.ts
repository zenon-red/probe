import { execSync } from "node:child_process";
import { pickLatestVTag } from "../src/utils/skills-check.js";
import { runSkillsRefCheck } from "../src/utils/skills-ref-release.js";

const strict = process.argv.includes("--strict");

function fetchLatestTagViaGh(): string | null {
  try {
    const out = execSync("gh api repos/zenon-red/skills/tags --paginate -q '.[].name'", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tags = out.split("\n").filter(Boolean);
    return pickLatestVTag(tags);
  } catch {
    return null;
  }
}

function fetchLatestTagViaGit(): string | null {
  try {
    const out = execSync("git ls-remote --tags https://github.com/zenon-red/skills.git", {
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

const latestTag = fetchLatestTagViaGh() ?? fetchLatestTagViaGit();
const { exitCode, lines } = runSkillsRefCheck({ latestTag, strict });

for (const line of lines) {
  console.error(line);
}

process.exit(exitCode);
