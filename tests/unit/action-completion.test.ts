import { describe, expect, it } from "bun:test";
import { buildContextCommands } from "../../src/commands/action.js";
import type { AgentAction } from "../../src/module_bindings/types.js";
import { completionGuideForAction } from "../../src/utils/action-completion.js";

function action(
  overrides: Partial<Pick<AgentAction, "id" | "route" | "targetType" | "targetId">> = {},
) {
  return {
    id: 42n,
    route: { tag: "AuthorizedDirective" },
    ...overrides,
  } as AgentAction;
}

describe("completionGuideForAction", () => {
  it("returns generic completion for authorized directives", () => {
    const guide = completionGuideForAction(action());
    expect(guide.command).toBe("probe action complete 42");
  });

  it("returns route-specific setup guidance", () => {
    const guide = completionGuideForAction(action({ route: { tag: "ProjectSetup" } }));
    expect(guide.command).toContain("probe project create");
    expect(guide.note).toContain("probe action complete-setup 42");
  });

  it("returns route-specific task creation guidance", () => {
    const guide = completionGuideForAction(action({ route: { tag: "CreateTasks" } }));
    expect(guide.command).toContain("probe task create");
    expect(guide.note).toContain("probe action complete-tasks 42");
  });

  it("returns merge-ready completion command", () => {
    const guide = completionGuideForAction(action({ route: { tag: "MergeReadyTask" } }));
    expect(guide.command).toBe("probe action complete-merge 42");
  });

  it("returns discovery review completion command", () => {
    const guide = completionGuideForAction(action({ route: { tag: "ReviewDiscovery" } }));
    expect(guide.command).toContain("probe action review-discovery 42");
  });

  it("returns spec submit completion without generic complete", () => {
    const guide = completionGuideForAction(action({ route: { tag: "SubmitSpec" }, targetId: "9" }));
    expect(guide.command).toBe(
      "probe project spec submit 9 --path <spec-path> --commit <sha> --hash <content-hash>",
    );
    expect(guide.command).not.toContain("probe action complete");
  });

  it("omits generic completion for proposal routes", () => {
    const guide = completionGuideForAction(action({ route: { tag: "ProposalScout" } }));
    expect(guide.command).toContain("probe idea propose");
    expect(guide.command).not.toContain("probe action complete");
  });
});

describe("buildContextCommands", () => {
  it("includes discovery lookup for review-discovery targets", () => {
    expect(
      buildContextCommands(action({ targetType: "discovered_task", targetId: "7" })),
    ).toContain("probe discover get 7");
  });
});
