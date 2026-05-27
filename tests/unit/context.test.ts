import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Identity } from "spacetimedb";
import { DEFAULT_CONFIG } from "../../src/types/config.js";

let capturedUri = "";
let capturedModule = "";

type ConnectHandler = (
  conn: {
    subscriptionBuilder: () => {
      onApplied: (cb: () => void) => { subscribe: (subs: string[]) => void };
      onError: (cb: (ctx: { event?: { message?: string } }) => void) => unknown;
      subscribe: (subs: string[]) => void;
    };
    disconnect: () => void;
  },
  identity: { toHexString: () => string },
  token: string,
) => void;

let connectHandler: ConnectHandler | undefined;

mock.module("../../src/module_bindings/index.js", () => ({
  DbConnection: {
    builder: () => {
      const builder = {
        withUri(uri: string) {
          capturedUri = uri;
          return builder;
        },
        withDatabaseName(name: string) {
          capturedModule = name;
          return builder;
        },
        withToken() {
          return builder;
        },
        onConnect(handler: ConnectHandler) {
          connectHandler = handler;
          return builder;
        },
        onDisconnect() {
          return builder;
        },
        onConnectError() {
          return builder;
        },
        build() {},
      };
      return builder;
    },
  },
  tables: {},
}));

mock.module("../../src/utils/token-cache.js", () => ({
  getCachedToken: mock(async () => null),
}));

import * as configModule from "../../src/utils/config.js";
import { CommandContext, commandContextOptions } from "../../src/utils/context.js";

describe("commandContextOptions", () => {
  it("forwards all three overrides when provided", () => {
    expect(
      commandContextOptions({
        wallet: "a",
        host: "ws://custom:3000",
        module: "nexus-dev",
      }),
    ).toEqual({
      wallet: "a",
      host: "ws://custom:3000",
      module: "nexus-dev",
    });
  });

  it("leaves host and module undefined when omitted", () => {
    const options = commandContextOptions({ wallet: "a" });
    expect(options.wallet).toBe("a");
    expect(options.host).toBeUndefined();
    expect(options.module).toBeUndefined();
  });

  it("merges extra options without config I/O", () => {
    expect(
      commandContextOptions(
        { wallet: "a", host: "ws://127.0.0.1:3000" },
        { subscribe: ["SELECT * FROM tasks"] },
      ),
    ).toEqual({
      wallet: "a",
      host: "ws://127.0.0.1:3000",
      subscribe: ["SELECT * FROM tasks"],
    });
  });
});

describe("CommandContext.create connection target", () => {
  beforeEach(() => {
    capturedUri = "";
    capturedModule = "";
    connectHandler = undefined;
  });

  afterEach(() => {
    mock.restore();
  });

  it("applies config defaults when helper omits host/module", async () => {
    const testConfig = {
      ...DEFAULT_CONFIG,
      spacetime: { host: "wss://test-default.example", module: "test-module" },
      requestTimeout: 100,
    };

    spyOn(configModule, "getConfig").mockResolvedValue(testConfig);
    const resolveSpy = spyOn(configModule, "resolveSpacetimeArgs");

    const createPromise = CommandContext.create(commandContextOptions({ wallet: "test-wallet" }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveSpy).toHaveBeenCalledWith({ wallet: "test-wallet" }, testConfig);
    expect(capturedUri).toBe("wss://test-default.example");
    expect(capturedModule).toBe("test-module");

    await expect(createPromise).rejects.toThrow("Connection timeout");
  });

  it("does not mutate global console methods during create", async () => {
    const testConfig = {
      ...DEFAULT_CONFIG,
      spacetime: { host: "wss://console.example", module: "nexus" },
      requestTimeout: 100,
    };

    spyOn(configModule, "getConfig").mockResolvedValue(testConfig);
    spyOn(configModule, "resolveSpacetimeArgs");

    const logRef = console.log;
    const errorRef = console.error;

    const createPromise = CommandContext.create(commandContextOptions({ wallet: "test-wallet" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(console.log).toBe(logRef);
    expect(console.error).toBe(errorRef);

    await expect(createPromise).rejects.toThrow("Connection timeout");
    expect(console.log).toBe(logRef);
    expect(console.error).toBe(errorRef);
  });

  it("assigns identity on connect before resolving context", async () => {
    const testConfig = {
      ...DEFAULT_CONFIG,
      spacetime: { host: "wss://identity.example", module: "nexus" },
      requestTimeout: 5000,
    };

    spyOn(configModule, "getConfig").mockResolvedValue(testConfig);
    spyOn(configModule, "resolveSpacetimeArgs");

    const identity = { toHexString: () => "deadbeef" } as unknown as Identity;
    const createPromise = CommandContext.create(commandContextOptions({ wallet: "test-wallet" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connectHandler).toBeDefined();

    const mockConn = {
      subscriptionBuilder: () => {
        let applied: (() => void) | undefined;
        const chain = {
          onApplied(cb: () => void) {
            applied = cb;
            return chain;
          },
          onError: () => chain,
          subscribe: (_subs: string[]) => {
            applied?.();
          },
        };
        return chain;
      },
      disconnect: () => {},
    };

    connectHandler!(mockConn, identity, "token-abc");

    const ctx = await createPromise;
    expect(ctx.identity).toBe(identity);
    await ctx[Symbol.asyncDispose]();
  });

  it("skips subscribe when subscribe is empty", async () => {
    const testConfig = {
      ...DEFAULT_CONFIG,
      spacetime: { host: "wss://identity.example", module: "nexus" },
      requestTimeout: 5000,
    };

    spyOn(configModule, "getConfig").mockResolvedValue(testConfig);
    spyOn(configModule, "resolveSpacetimeArgs");

    const identity = { toHexString: () => "abc" } as unknown as Identity;
    const createPromise = CommandContext.create(
      commandContextOptions({ wallet: "test-wallet" }, { subscribe: [] }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const mockConn = {
      subscriptionBuilder: () => {
        throw new Error("subscriptionBuilder should not run");
      },
      disconnect: () => {},
    };

    connectHandler!(mockConn, identity, "token-abc");

    const ctx = await createPromise;
    expect(ctx.identity).toBe(identity);
    await ctx[Symbol.asyncDispose]();
  });
});
