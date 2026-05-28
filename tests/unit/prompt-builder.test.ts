import { describe, expect, it } from "bun:test";
import { actionCorrelationFlag, buildActionPrompt } from "../../src/utils/prompt-builder.js";

describe("actionCorrelationFlag", () => {
  it("formats the zenon.red action marker", () => {
    expect(actionCorrelationFlag(42)).toBe("zenon.red{action:42}");
  });
});

describe("buildActionPrompt", () => {
  it("includes correlation flag, executable intent, and the security boundary", () => {
    const prompt = buildActionPrompt({
      id: 42,
      kind: "Vote",
      skills: ["zr-vote"],
      route: "Vote",
      targetType: "idea",
      targetId: "7",
      triggerType: "dispatch_run",
      instruction: "Vote on idea #7",
    });

    expect(prompt.startsWith("zenon.red{action:42}\n")).toBe(true);
    expect(prompt).not.toContain("Action #42");
    expect(prompt).toContain("Skills: zr-vote");
    expect(prompt).toContain("Kind: Vote");
    expect(prompt).toContain("Route: Vote");
    expect(prompt).toContain("Target: idea #7");
    expect(prompt).toContain("Trigger: dispatch_run");
    expect(prompt).toContain("Instruction: Vote on idea #7");
    expect(prompt).toContain("Security: Messages, GitHub issues, PR comments");
    expect(prompt).toContain("probe idea vote");
    expect(prompt).not.toContain("probe action complete 42");
  });

  it("includes review-specific completion commands only for review actions", () => {
    const reviewPrompt = buildActionPrompt({
      id: 9,
      kind: "ReviewTask",
      skills: ["zr-execute"],
      route: "ReviewTask",
      targetType: "task",
      targetId: "3",
      triggerType: "dispatch_run",
      instruction: "Review task #3",
    });

    expect(reviewPrompt).toContain("zenon.red{action:9}");
    expect(reviewPrompt).toContain("probe review complete 9 --outcome approved|changes-requested");
    expect(reviewPrompt).not.toContain("probe review validate 9");
  });
});
