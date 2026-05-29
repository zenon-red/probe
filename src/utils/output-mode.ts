import { setGlobalLogLevel, type LogLevel } from "spacetimedb";

let jsonMode = false;
let sdkLogLevelConfigured = false;

export function configureSdkLogLevel(force = false): void {
  if (sdkLogLevelConfigured && !force) return;

  const level: LogLevel = process.env.PROBE_DEBUG?.trim() ? "debug" : "error";
  setGlobalLogLevel(level);
  sdkLogLevelConfigured = true;
}

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
}

export function applyJsonMode(args: { json?: boolean }): void {
  if (args.json) setJsonMode(true);
}

export function isJsonMode(): boolean {
  return jsonMode;
}
