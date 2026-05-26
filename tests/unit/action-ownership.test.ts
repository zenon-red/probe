import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as contextModule from "../../src/utils/context.js";
import { actionCompleteCommand, actionFailCommand } from "../../src/commands/action.js";
import { reviewCompleteCommand } from "../../src/commands/review/index.js";

const updateAgentAction = mock(async () => {});
const completeReviewAction = mock(async () => {});

let mockCtx: Record<string, unknown>;

const OWN_IDENTITY = { toHexString: () => "aa".repeat(32) };

function baseAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 42n,
    agentId: "agent-1",
    kind: { tag: "Task" },
    reasonCode: "test",
    status: { tag: "Issued" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    route: { tag: "ExecuteTask" },
    ...overrides,
  };
}

function ownedContext(actionOverrides: Record<string, unknown> = {}) {
  mockCtx = {
    auth: { identity: OWN_IDENTITY },
    identity: OWN_IDENTITY,
    agents: [{ id: "agent-1", identity: OWN_IDENTITY }],
    agentActions: [baseAction(actionOverrides)],
    conn: {
      reducers: {
        updateAgentAction,
        completeReviewAction,
        completeValidateReviewAction: mock(async () => {}),
      },
    },
  };
}

function installActionMocks() {
  spyOn(contextModule, "withAuth").mockImplementation(async (_options, handler) => {
    return await handler(mockCtx as unknown as contextModule.CommandContext);
  });
  spyOn(contextModule, "callReducer").mockImplementation(async (_ctx, reducer, params) => {
    await reducer(params);
  });
}

describe("action ownership verification", () => {
  afterEach(() => {
    mock.restore();
  });

  it("rejects complete when action is not found", async () => {
    mockCtx = {
      auth: { identity: OWN_IDENTITY },
      agents: [{ id: "agent-1", identity: OWN_IDENTITY }],
      agentActions: [],
      conn: { reducers: { updateAgentAction } },
    };
    installActionMocks();

    await expect(
      actionCompleteCommand.run?.({
        args: { _: [], id: "99", wallet: "w", json: false },
      } as never),
    ).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
  });

  it("rejects complete when action belongs to another agent", async () => {
    mockCtx = {
      auth: { identity: OWN_IDENTITY },
      agents: [{ id: "agent-1", identity: OWN_IDENTITY }],
      agentActions: [baseAction({ agentId: "agent-2" })],
      conn: { reducers: { updateAgentAction } },
    };
    installActionMocks();

    await expect(
      actionCompleteCommand.run?.({
        args: { _: [], id: "42", wallet: "w", json: false },
      } as never),
    ).rejects.toMatchObject({ code: "NOT_OWNER" });
  });

  it("rejects complete on ReviewTask route", async () => {
    ownedContext({ route: { tag: "ReviewTask" } });
    installActionMocks();

    await expect(
      actionCompleteCommand.run?.({
        args: { _: [], id: "42", wallet: "w", json: false },
      } as never),
    ).rejects.toMatchObject({ code: "WRONG_ROUTE" });
  });

  it("rejects complete on ProjectSetup route", async () => {
    ownedContext({ route: { tag: "ProjectSetup" } });
    installActionMocks();

    await expect(
      actionCompleteCommand.run?.({
        args: { _: [], id: "42", wallet: "w", json: false },
      } as never),
    ).rejects.toMatchObject({ code: "WRONG_ROUTE" });
  });

  it("completes owned non-review actions", async () => {
    ownedContext();
    installActionMocks();

    await actionCompleteCommand.run?.({
      args: { _: [], id: "42", wallet: "w", json: false },
    } as never);

    expect(updateAgentAction).toHaveBeenCalledWith({
      actionId: 42n,
      eventType: { tag: "Completed" },
      eventCode: undefined,
      note: undefined,
    });
  });

  it("allows fail when ownership is verified", async () => {
    ownedContext();
    installActionMocks();

    await actionFailCommand.run?.({
      args: { _: [], id: "42", reason: "blocked", wallet: "w", json: false },
    } as never);

    expect(updateAgentAction).toHaveBeenCalledWith({
      actionId: 42n,
      eventType: { tag: "Failed" },
      eventCode: undefined,
      note: "blocked",
    });
  });

  it("rejects review when route is not ReviewTask", async () => {
    ownedContext({ route: { tag: "ExecuteTask" } });
    installActionMocks();

    await expect(
      reviewCompleteCommand.run?.({
        args: {
          _: [],
          id: "42",
          outcome: "approved",
          summary: "looks good",
          "artifact-url": "https://github.com/zenon-red/probe/pull/1#pullrequestreview-2",
          wallet: "w",
          json: false,
        },
      } as never),
    ).rejects.toMatchObject({ code: "WRONG_ROUTE" });
  });

  it("completes review on owned ReviewTask actions", async () => {
    ownedContext({ route: { tag: "ReviewTask" } });
    installActionMocks();

    await reviewCompleteCommand.run?.({
      args: {
        _: [],
        id: "42",
        outcome: "approved",
        summary: "looks good",
        "artifact-url": "https://github.com/zenon-red/probe/pull/1#pullrequestreview-2",
        wallet: "w",
        json: false,
      },
    } as never);

    expect(completeReviewAction).toHaveBeenCalledWith({
      actionId: 42n,
      outcome: { tag: "Approved" },
      summary: "looks good",
      artifactKind: "review",
      artifactUrl: "https://github.com/zenon-red/probe/pull/1#pullrequestreview-2",
      artifactMetadata: undefined,
    });
  });

  it("rejects review with invalid outcome before ownership check", async () => {
    ownedContext({ route: { tag: "ReviewTask" } });
    installActionMocks();

    await expect(
      reviewCompleteCommand.run?.({
        args: {
          _: [],
          id: "42",
          outcome: "maybe",
          summary: "looks good",
          "artifact-url": "https://github.com/zenon-red/probe/pull/1#pullrequestreview-2",
          wallet: "w",
          json: false,
        },
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
  });
});
