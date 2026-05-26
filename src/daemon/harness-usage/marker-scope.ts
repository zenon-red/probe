import { DEFAULT_PROMPT_MARKER_TEMPLATE, promptMarkerPrefix } from "~/utils/prompt-marker.js";

export function resolveMarkerPrefix(promptMarkerTemplate?: string): string {
  return promptMarkerPrefix(promptMarkerTemplate ?? DEFAULT_PROMPT_MARKER_TEMPLATE);
}

export function recordContainsOtherActionMarker(
  record: unknown,
  marker: string,
  markerPrefix: string,
): boolean {
  if (!record || typeof record !== "object") return false;
  const text = JSON.stringify(record);
  if (!text.includes(markerPrefix)) return false;
  return !text.includes(marker);
}

export function scopeTextByMarker(text: string, marker: string, markerPrefix: string): string {
  const start = text.indexOf(marker);
  if (start === -1) return "";
  const slice = text.slice(start);
  const next = slice.indexOf(markerPrefix, marker.length);
  return next === -1 ? slice : slice.slice(0, next);
}

export function scopeJsonlLines(lines: string[], marker: string, markerPrefix: string): string[] {
  const scoped: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.includes(marker)) {
      capturing = true;
      scoped.push(line);
      continue;
    }
    if (capturing) {
      if (line.includes(markerPrefix)) break;
      scoped.push(line);
    }
  }
  return scoped;
}
