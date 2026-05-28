import { describe, expect, it } from "bun:test";
import idea from "../../src/commands/nexus/idea.js";
import { parseReviewDecision } from "../../src/commands/nexus/idea/shared.js";
import { IdeaStatus } from "../../src/utils/enums.js";

describe("idea human review helpers", () => {
  it("parseReviewDecision maps CLI values to ReviewDecision tags", () => {
    expect(parseReviewDecision("approved")).toEqual({ tag: "Approved" });
    expect(parseReviewDecision("REJECTED")).toEqual({ tag: "Rejected" });
    expect(parseReviewDecision(" changes-requested ")).toEqual({ tag: "ChangesRequested" });
  });

  it("parseReviewDecision rejects unknown decisions", () => {
    expect(() => parseReviewDecision("maybe")).toThrow(
      expect.objectContaining({ code: "INVALID_DECISION" }),
    );
  });
});

describe("IdeaStatus", () => {
  it("matches voting filter for Voting status only", () => {
    expect(IdeaStatus.matches({ tag: "Voting" }, "voting")).toBe(true);
    expect(IdeaStatus.matches({ tag: "PendingHumanReview" }, "voting")).toBe(false);
  });

  it("is.voting matches matches(..., voting)", () => {
    const voting = { tag: "Voting" } as const;
    expect(IdeaStatus.is.voting(voting)).toBe(IdeaStatus.matches(voting, "voting"));
  });
});

describe("idea subcommands", () => {
  it("exposes human review subcommands", () => {
    expect(Object.keys(idea.subCommands ?? {}).sort()).toEqual([
      "dimensions",
      "get",
      "list",
      "pending",
      "propose",
      "review",
      "vote",
    ]);
  });
});
