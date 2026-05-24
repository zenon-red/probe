import { MARKER_PREFIX } from "./types.js";

export { MARKER_PREFIX };

export function recordContainsOtherActionMarker(record: unknown, marker: string): boolean {
  if (!record || typeof record !== "object") return false;
  const text = JSON.stringify(record);
  if (!text.includes(MARKER_PREFIX)) return false;
  return !text.includes(marker);
}

export function scopeTextByMarker(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start === -1) return "";
  const slice = text.slice(start);
  const next = slice.indexOf(MARKER_PREFIX, marker.length);
  return next === -1 ? slice : slice.slice(0, next);
}

export function scopeJsonlLines(lines: string[], marker: string): string[] {
  const scoped: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.includes(marker)) {
      capturing = true;
      scoped.push(line);
      continue;
    }
    if (capturing) {
      if (line.includes(MARKER_PREFIX)) break;
      scoped.push(line);
    }
  }
  return scoped;
}
