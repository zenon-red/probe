export function getNested(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function getNumber(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return null;
}
