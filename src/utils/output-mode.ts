import { AsyncLocalStorage } from "node:async_hooks";

const outputModeStorage = new AsyncLocalStorage<{ jsonMode: boolean }>();
let jsonModeFallback = false;

export function setJsonMode(enabled: boolean) {
  jsonModeFallback = enabled;
  outputModeStorage.enterWith({ jsonMode: enabled });
}

export function applyJsonMode(args: { json?: boolean }): void {
  if (args.json) setJsonMode(true);
}

export function isJsonMode(): boolean {
  return outputModeStorage.getStore()?.jsonMode === true || jsonModeFallback;
}
