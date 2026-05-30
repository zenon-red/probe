import { renderPromptMarker } from "./prompt-marker.js";

export type NexusPromptBoundaryParams = {
  correlationFlag: string;
  route: string;
};

/** Sanitize a boundary segment for HTML comments (no `--`, no raw whitespace). */
export function sanitizeNexusBoundarySegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Nexus prompt boundary segment must be non-empty");
  }
  return trimmed.replace(/\s+/g, "_").replace(/--+/g, "-");
}

export function nexusPromptBoundaryTag(
  params: NexusPromptBoundaryParams,
  phase: "START" | "END",
): string {
  const flag = sanitizeNexusBoundarySegment(params.correlationFlag);
  const route = sanitizeNexusBoundarySegment(params.route);
  return `<!-- NEXUS:${flag}:${route}:${phase} -->`;
}

export function nexusPromptBoundaryParams(
  actionId: bigint | number,
  route: string,
  promptMarkerTemplate: string,
): NexusPromptBoundaryParams {
  return {
    correlationFlag: renderPromptMarker(promptMarkerTemplate, actionId),
    route,
  };
}

export function wrapNexusPromptBody(params: NexusPromptBoundaryParams, body: string): string {
  const start = nexusPromptBoundaryTag(params, "START");
  const end = nexusPromptBoundaryTag(params, "END");
  const trimmedBody = body.trimEnd();
  if (!trimmedBody) {
    return `${start}\n${end}`;
  }
  return `${start}\n${trimmedBody}\n${end}`;
}
