let jsonMode = false;

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
}

export function applyJsonMode(args: { json?: boolean }): void {
  if (args.json) setJsonMode(true);
}

export function isJsonMode(): boolean {
  return jsonMode;
}
