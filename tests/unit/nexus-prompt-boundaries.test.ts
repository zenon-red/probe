import { describe, expect, it } from "bun:test";
import {
  nexusPromptBoundaryParams,
  nexusPromptBoundaryTag,
  sanitizeNexusBoundarySegment,
  wrapNexusPromptBody,
} from "../../src/utils/nexus-prompt-boundaries.js";

describe("nexusPromptBoundaryTag", () => {
  it("embeds the full correlation flag in the sentinel", () => {
    expect(
      nexusPromptBoundaryTag({ correlationFlag: "zenon.red{action:42}", route: "Vote" }, "START"),
    ).toBe("<!-- NEXUS:zenon.red{action:42}:Vote:START -->");
    expect(
      nexusPromptBoundaryTag({ correlationFlag: "zenon.red{action:42}", route: "Vote" }, "END"),
    ).toBe("<!-- NEXUS:zenon.red{action:42}:Vote:END -->");
  });

  it("sanitizes segments that would break HTML comments", () => {
    expect(sanitizeNexusBoundarySegment("bad--org")).toBe("bad-org");
    expect(
      nexusPromptBoundaryTag(
        { correlationFlag: "zenon red{action:1}", route: "Continue Owned" },
        "START",
      ),
    ).toBe("<!-- NEXUS:zenon_red{action:1}:Continue_Owned:START -->");
  });
});

describe("nexusPromptBoundaryParams", () => {
  it("renders flag from genesis promptMarker template", () => {
    const params = nexusPromptBoundaryParams(42, "Vote", "zenon.red{action:%ACTION_ID%}");
    expect(params.correlationFlag).toBe("zenon.red{action:42}");
    expect(params.route).toBe("Vote");
  });
});

describe("wrapNexusPromptBody", () => {
  it("wraps body between START and END", () => {
    const wrapped = wrapNexusPromptBody(
      { correlationFlag: "zenon.red{action:9}", route: "ReviewTask" },
      "Instruction: review task #3",
    );
    expect(wrapped).toBe(
      [
        "<!-- NEXUS:zenon.red{action:9}:ReviewTask:START -->",
        "Instruction: review task #3",
        "<!-- NEXUS:zenon.red{action:9}:ReviewTask:END -->",
      ].join("\n"),
    );
  });
});
