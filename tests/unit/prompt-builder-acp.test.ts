import { describe, expect, it } from "bun:test";
import { buildActionPromptAcp } from "../../src/utils/prompt-builder-acp.js";

describe("buildActionPromptAcp", () => {
  it("wraps content in NEXUS sentinels with embedded correlation flag", () => {
    const { text } = buildActionPromptAcp({
      id: 42,
      kind: "Vote",
      skills: ["zr-vote"],
      route: "Vote",
      targetType: "idea",
      targetId: "7",
      triggerType: "dispatch_run",
      instruction: "Vote on idea #7",
    });

    expect(text.startsWith("<!-- NEXUS:zenon.red{action:42}:Vote:START -->")).toBe(true);
    expect(text).toContain("Instruction: Vote on idea #7");
    expect(text.endsWith("<!-- NEXUS:zenon.red{action:42}:Vote:END -->")).toBe(true);
    expect(text).not.toContain("probe action complete");
  });
});
