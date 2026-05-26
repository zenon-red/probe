export type ParsedGithubArtifactUrl = {
  org: string;
  repo: string;
  number: number;
  pullNumber?: number;
  kind: "pull_request" | "review" | "review_comment" | "issue";
};

export function normalizeArtifactKind(kind: string): string {
  const k = kind.trim().toLowerCase().replace(/-/g, "_");
  const allowed = ["pull_request", "review", "review_comment", "issue"];
  if (!allowed.includes(k)) {
    throw new Error(`Unknown artifact kind: ${kind}. Allowed: ${allowed.join(", ")}`);
  }
  return k;
}

export function assertGithubArtifactKind(
  parsed: ParsedGithubArtifactUrl,
  expectedKind: string,
): void {
  if (parsed.kind !== expectedKind) {
    throw new Error(`Artifact URL is ${parsed.kind}, not ${expectedKind}`);
  }
}

export function parseGithubArtifactUrl(url: string): ParsedGithubArtifactUrl {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Unrecognized GitHub artifact URL: ${url}`);
  }

  if (parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error(`Unrecognized GitHub artifact URL: ${url}`);
  }

  const [org, repo, resource, numberRaw, detail, detailNumberRaw] = parsed.pathname
    .split("/")
    .filter(Boolean);
  if (!org || !repo || !resource || !numberRaw) {
    throw new Error(`Unrecognized GitHub artifact URL: ${url}`);
  }

  const number = Number(numberRaw);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Unrecognized GitHub artifact URL: ${url}`);
  }

  if (resource === "issues" && !detail) {
    return { org, repo, number, kind: "issue" };
  }

  if (resource === "pull") {
    const hash = parsed.hash.slice(1);
    const reviewHash = /^pullrequestreview-(\d+)$/.exec(hash);
    if (reviewHash) {
      return {
        org,
        repo,
        number: Number(reviewHash[1]),
        pullNumber: number,
        kind: "review",
      };
    }

    const commentHash = /^(?:discussion_r|r)(\d+)$/.exec(hash);
    if (commentHash) {
      return {
        org,
        repo,
        number: Number(commentHash[1]),
        pullNumber: number,
        kind: "review_comment",
      };
    }

    if ((detail === "reviews" || detail === "review") && detailNumberRaw) {
      const reviewNumber = Number(detailNumberRaw);
      if (Number.isSafeInteger(reviewNumber) && reviewNumber > 0) {
        return { org, repo, number: reviewNumber, pullNumber: number, kind: "review" };
      }
    }

    if (!detail || detail === "files") {
      return { org, repo, number, kind: "pull_request" };
    }
  }

  throw new Error(`Unrecognized GitHub artifact URL: ${url}`);
}

export async function verifyGithubArtifactUrl(
  url: string,
  expectedOrg?: string,
): Promise<ParsedGithubArtifactUrl> {
  const parsed = parseGithubArtifactUrl(url);
  if (expectedOrg && parsed.org.toLowerCase() !== expectedOrg.toLowerCase()) {
    throw new Error(`URL org ${parsed.org} does not match genesis org ${expectedOrg}`);
  }
  const { execSync } = await import("node:child_process");
  const { commandExists } = await import("~/utils/system.js");
  const { SHELL_TIMEOUT } = await import("~/utils/timeouts.js");
  if (!commandExists("gh")) return parsed;
  try {
    const targetNumber =
      parsed.kind === "issue" ? parsed.number : (parsed.pullNumber ?? parsed.number);
    const command =
      parsed.kind === "issue"
        ? `gh issue view ${targetNumber} --repo ${parsed.org}/${parsed.repo} --json url`
        : `gh pr view ${targetNumber} --repo ${parsed.org}/${parsed.repo} --json url`;
    execSync(command, {
      stdio: "ignore",
      timeout: SHELL_TIMEOUT.MEDIUM,
    });
  } catch {
    throw new Error(`gh could not verify artifact URL: ${url}`);
  }
  return parsed;
}
