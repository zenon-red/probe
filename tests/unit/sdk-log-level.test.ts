import { afterEach, describe, expect, it } from "bun:test";
import { getGlobalLogLevel, setGlobalLogLevel } from "spacetimedb";
import { configureSdkLogLevel } from "../../src/utils/output-mode.js";

describe("configureSdkLogLevel", () => {
  const originalDebug = process.env.PROBE_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.PROBE_DEBUG;
    } else {
      process.env.PROBE_DEBUG = originalDebug;
    }
    setGlobalLogLevel("info");
    configureSdkLogLevel(true);
  });

  it("defaults to error level", () => {
    delete process.env.PROBE_DEBUG;
    setGlobalLogLevel("info");

    configureSdkLogLevel(true);

    expect(getGlobalLogLevel()).toBe("error");
  });

  it("sets debug level when PROBE_DEBUG is set", () => {
    process.env.PROBE_DEBUG = "1";
    setGlobalLogLevel("info");

    configureSdkLogLevel(true);

    expect(getGlobalLogLevel()).toBe("debug");
  });

  it("is idempotent unless forced", () => {
    delete process.env.PROBE_DEBUG;
    configureSdkLogLevel(true);
    setGlobalLogLevel("info");

    configureSdkLogLevel();

    expect(getGlobalLogLevel()).toBe("info");

    configureSdkLogLevel(true);

    expect(getGlobalLogLevel()).toBe("error");
  });
});
