import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/types/config.js";
import type { Channel, CommandContext, Project } from "../../src/utils/context.js";
import { sendMessage, validateMessageContent } from "../../src/commands/nexus/message-send.js";
import { MessageType } from "../../src/utils/enums.js";

describe("validateMessageContent", () => {
  it("rejects content over max length", () => {
    const violation = validateMessageContent("x".repeat(4001), false);
    expect(violation).toEqual({ type: "length", length: 4001, max: 4000 });
  });

  it("allows control sequences when raw is true", () => {
    expect(validateMessageContent("\x1b[31mred\x1b[0m", true)).toBeNull();
  });

  it("rejects ANSI control sequences when raw is false", () => {
    const violation = validateMessageContent("plain \x1b[31mred", false);
    expect(violation?.type).toBe("control");
    if (violation?.type === "control") {
      expect(violation.position).toBeGreaterThan(0);
      expect(violation.sequence).toContain("\\x1b");
    }
  });

  it("accepts plain text within limits", () => {
    expect(validateMessageContent("hello team", false)).toBeNull();
  });
});

describe("sendMessage", () => {
  const projects = [{ id: 42n, name: "alpha" }] as Project[];
  const channels = [{ id: 7n, name: "general" }] as Channel[];

  function mockCtx(overrides: Partial<CommandContext> = {}): CommandContext {
    return {
      projects,
      channels,
      messages: [],
      projectMessages: [],
      projectChannels: [],
      config: DEFAULT_CONFIG,
      conn: {
        reducers: {
          sendMessage: async () => {},
          sendProjectMessage: async () => {},
        },
      },
      ...overrides,
    } as unknown as CommandContext;
  }

  it("rejects directive type on message send", async () => {
    await expect(
      sendMessage(mockCtx(), "general", "hello", { mode: "user", typeInput: "directive" }),
    ).rejects.toMatchObject({ code: "INVALID_TYPE" });
  });

  it("rejects invalid content before resolving target", async () => {
    await expect(
      sendMessage(mockCtx(), "missing-channel", "\x1b[0m", {
        mode: "fixed",
        messageType: "directive",
      }),
    ).rejects.toMatchObject({ code: "MESSAGE_CONTENT_INVALID" });
  });

  it("uses fixed directive type policy for directive subcommand", async () => {
    let capturedType: unknown;
    const ctx = mockCtx({
      conn: {
        reducers: {
          sendMessage: async (params: { messageType: unknown }) => {
            capturedType = params.messageType;
          },
          sendProjectMessage: async () => {},
        },
      },
    } as unknown as Partial<CommandContext>);

    await sendMessage(ctx, "general", "do the thing", { mode: "fixed", messageType: "directive" });

    expect(capturedType).toEqual(MessageType.fromString("directive"));
  });
});
