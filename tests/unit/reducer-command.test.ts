import { afterEach, describe, expect, it, mock } from "bun:test";
import { ProbeError } from "../../src/utils/errors.js";

const capturedWithAuthOptions: Record<string, unknown>[] = [];

const withAuthMock = mock(
  async (options: Record<string, unknown>, handler: (ctx: unknown) => Promise<void>) => {
    capturedWithAuthOptions.push(options);
    await handler({
      conn: {
        reducers: {
          createProject: mock(async () => {}),
          failReducer: mock(async () => {
            throw new Error("reducer rejected");
          }),
        },
      },
    });
  },
);

mock.module("../../src/utils/context.js", () => ({
  withAuth: withAuthMock,
  commandContextOptions: (
    args: { wallet?: string; host?: string; module?: string },
    extra?: Record<string, unknown>,
  ) => ({ ...extra, ...args }),
  callReducer: mock(
    async (_ctx: unknown, reducer: (params: unknown) => Promise<void>, params: unknown) => {
      await reducer(params);
    },
  ),
}));

import { runReducerCommand } from "../../src/utils/reducer-command.js";

describe("runReducerCommand", () => {
  afterEach(() => {
    withAuthMock.mockClear();
    capturedWithAuthOptions.length = 0;
  });

  it("calls withAuth using commandContextOptions and completes on success", async () => {
    const reducerSpy = mock(async () => {});

    await runReducerCommand(
      { wallet: "w", host: "ws://127.0.0.1:3000", module: "nexus-dev" },
      {
        subscribe: [],
        reducer: () => reducerSpy,
        params: { projectId: 1n },
      },
    );

    expect(withAuthMock).toHaveBeenCalledTimes(1);
    const options = capturedWithAuthOptions[0];
    expect(options?.wallet).toBe("w");
    expect(options?.host).toBe("ws://127.0.0.1:3000");
    expect(options?.module).toBe("nexus-dev");
    expect(options?.subscribe).toEqual([]);
    expect(reducerSpy).toHaveBeenCalledWith({ projectId: 1n });
  });

  it("maps reducer failures to REDUCER_FAILED", async () => {
    await expect(
      runReducerCommand(
        { wallet: "w" },
        {
          reducer: (ctx) =>
            (
              ctx.conn.reducers as unknown as {
                failReducer: (params: Record<string, never>) => Promise<void>;
              }
            ).failReducer,
          params: {},
        },
      ),
    ).rejects.toMatchObject({ code: "REDUCER_FAILED", message: "reducer rejected" });
  });

  it("rethrows ProbeError without wrapping as REDUCER_FAILED", async () => {
    withAuthMock.mockImplementationOnce(async () => {
      throw ProbeError.of("NOT_OWNER", "not yours");
    });

    await expect(
      runReducerCommand(
        { wallet: "w" },
        {
          reducer: (ctx) => ctx.conn.reducers.createProject,
          params: {
            sourceIdeaId: 1n,
            name: "n",
            githubRepo: "https://github.com/a/b",
            description: "",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_OWNER" });
  });
});
