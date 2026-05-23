import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as contextModule from "../../src/utils/context.js";
import projectList from "../../src/commands/nexus/project/list.js";
import { taskCreateCommand } from "../../src/commands/nexus/task/create.js";

describe("host/module forwarding in commands", () => {
  const capturedCreateOptions: Record<string, unknown>[] = [];
  const capturedWithAuthOptions: Record<string, unknown>[] = [];

  afterEach(() => {
    capturedCreateOptions.length = 0;
    capturedWithAuthOptions.length = 0;
    mock.restore();
  });

  it("read command forwards host/module to CommandContext.create", async () => {
    spyOn(contextModule.CommandContext, "create").mockImplementation(async (options) => {
      capturedCreateOptions.push(options as Record<string, unknown>);
      return {
        projects: [],
        [Symbol.asyncDispose]: async () => {},
      } as unknown as contextModule.CommandContext;
    });

    await projectList.run?.({
      args: {
        _: [],
        host: "ws://read-host:3000",
        module: "read-module",
        json: false,
      },
    } as never);

    expect(capturedCreateOptions[0]).toMatchObject({
      host: "ws://read-host:3000",
      module: "read-module",
    });
  });

  it("write command forwards host/module to withAuth", async () => {
    spyOn(contextModule, "withAuth").mockImplementation(async (options, handler) => {
      capturedWithAuthOptions.push(options as Record<string, unknown>);
      await handler({
        conn: {
          reducers: {
            createTask: mock(async () => {}),
          },
        },
      } as unknown as contextModule.CommandContext);
      return undefined as never;
    });

    spyOn(contextModule, "callReducer").mockImplementation(async (_ctx, reducer, params) => {
      await reducer(params);
    });

    await taskCreateCommand.run?.({
      args: {
        _: [],
        wallet: "test-wallet",
        host: "ws://write-host:3000",
        module: "write-module",
        project: "1",
        title: "Test task",
        json: false,
      },
    } as never);

    expect(capturedWithAuthOptions[0]).toMatchObject({
      wallet: "test-wallet",
      host: "ws://write-host:3000",
      module: "write-module",
    });
  });
});
