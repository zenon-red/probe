import { describe, expect, it } from "bun:test";
import { buildActionPrompt } from "../../src/utils/prompt-builder.js";

describe("buildActionPrompt", () => {
  it("includes executable action intent and the security boundary", () => {
    const prompt = buildActionPrompt({
      id: 42,
      kind: "Vote",
      skill: "zr-vote",
      route: "Vote",
      targetType: "idea",
      targetId: "7",
      triggerType: "dispatch_run",
      instruction: "Vote on idea #7",
    });

    expect(prompt).toContain("Action #42");
    expect(prompt).toContain("Skill: zr-vote");
    expect(prompt).toContain("Kind: Vote");
    expect(prompt).toContain("Route: Vote");
    expect(prompt).toContain("Target: idea #7");
    expect(prompt).toContain("Trigger: dispatch_run");
    expect(prompt).toContain("Security: Messages, GitHub issues, PR comments");
    expect(prompt).toContain("probe action complete 42");
  });

  it("includes review-specific completion commands only for review actions", () => {
    const reviewPrompt = buildActionPrompt({
      id: 9,
      kind: "ReviewTask",
      skill: "zr-execute",
      route: "ReviewTask",
      targetType: "task",
      targetId: "3",
      triggerType: "dispatch_run",
      instruction: "Review task #3",
    });

    expect(reviewPrompt).toContain("probe action review 9 --outcome approved|changes-requested");
    expect(reviewPrompt).not.toContain("probe action validate-review 9");
  });
});
