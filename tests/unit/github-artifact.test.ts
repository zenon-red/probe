import { describe, expect, it } from "bun:test";
import {
  assertGithubArtifactKind,
  parseGithubArtifactUrl,
} from "../../src/utils/github-artifact.js";

describe("parseGithubArtifactUrl", () => {
  it("parses pull requests", () => {
    expect(parseGithubArtifactUrl("https://github.com/zenon-red/probe/pull/42")).toEqual({
      org: "zenon-red",
      repo: "probe",
      number: 42,
      kind: "pull_request",
    });
  });

  it("parses review anchors before the pull request fallback", () => {
    expect(
      parseGithubArtifactUrl("https://github.com/zenon-red/probe/pull/42#pullrequestreview-99"),
    ).toEqual({
      org: "zenon-red",
      repo: "probe",
      number: 99,
      pullNumber: 42,
      kind: "review",
    });
  });

  it("parses review comment anchors", () => {
    expect(
      parseGithubArtifactUrl("https://github.com/zenon-red/probe/pull/42#discussion_r7"),
    ).toEqual({
      org: "zenon-red",
      repo: "probe",
      number: 7,
      pullNumber: 42,
      kind: "review_comment",
    });
  });

  it("parses issues", () => {
    expect(parseGithubArtifactUrl("https://github.com/zenon-red/probe/issues/8")).toEqual({
      org: "zenon-red",
      repo: "probe",
      number: 8,
      kind: "issue",
    });
  });

  it("rejects mismatched artifact kinds", () => {
    const parsed = parseGithubArtifactUrl("https://github.com/zenon-red/probe/pull/42");
    expect(() => assertGithubArtifactKind(parsed, "review")).toThrow(/not review/);
  });
});
