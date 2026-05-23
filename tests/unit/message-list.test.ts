import { describe, expect, it } from "bun:test";
import type { Channel, CommandContext, Message } from "../../src/utils/context.js";
import { listMessages } from "../../src/commands/nexus/message-list.js";
import { MessageType } from "../../src/utils/enums.js";

const ts = (micros: bigint) => ({ microsSinceUnixEpoch: micros });

describe("listMessages", () => {
  const channels = [{ id: 7n, name: "general" }] as Channel[];

  const messages = [
    {
      id: 1n,
      channelId: 7n,
      content: "older user",
      messageType: MessageType.fromString("user"),
      createdAt: ts(1_000_000n),
      contextId: "",
    },
    {
      id: 2n,
      channelId: 7n,
      content: "newer directive",
      messageType: MessageType.fromString("directive"),
      createdAt: ts(2_000_000n),
      contextId: "",
    },
    {
      id: 3n,
      channelId: 7n,
      content: "newest user",
      messageType: MessageType.fromString("user"),
      createdAt: ts(3_000_000n),
      contextId: "",
    },
  ] as Message[];

  function mockCtx(): CommandContext {
    return {
      channels,
      projects: [],
      messages,
      projectMessages: [],
    } as unknown as CommandContext;
  }

  it("applies the same sort and limit for list vs directives", () => {
    const ctx = mockCtx();
    const userResult = listMessages(ctx, "general", "user", 2);
    const directiveResult = listMessages(ctx, "general", "directive", 2);

    expect(userResult.count).toBe(2);
    expect(directiveResult.count).toBe(1);
    expect(userResult.messages.map((m) => m.id)).toEqual([3n, 1n]);
    expect(directiveResult.messages.map((m) => m.id)).toEqual([2n]);
  });

  it("differs only by message kind filter", () => {
    const ctx = mockCtx();
    const userIds = new Set(
      listMessages(ctx, "general", "user", 10).messages.map((m) => m.id.toString()),
    );
    const directiveIds = new Set(
      listMessages(ctx, "general", "directive", 10).messages.map((m) => m.id.toString()),
    );

    expect([...userIds].sort()).toEqual(["1", "3"]);
    expect([...directiveIds]).toEqual(["2"]);
    expect([...userIds].some((id) => directiveIds.has(id))).toBe(false);
  });
});
