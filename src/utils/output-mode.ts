import { setGlobalLogLevel } from "spacetimedb";

let jsonMode = false;

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
  if (enabled) {
    // Suppress SDK info/debug/trace logs — they go to stdout via console.log
    // and corrupt --json output. Agents pipe this to JSON.parse().
    setGlobalLogLevel("error");
  }
}

export function applyJsonMode(args: { json?: boolean }): void {
  if (args.json) setJsonMode(true);
}

export function isJsonMode(): boolean {
  return jsonMode;
}
