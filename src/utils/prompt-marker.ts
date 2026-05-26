export const PROMPT_MARKER_PLACEHOLDER = "%ACTION_ID%";

/** Production default; lab genesis uses `zenon.red.lab{action:%ACTION_ID%}`. */
export const DEFAULT_PROMPT_MARKER_TEMPLATE = "zenon.red{action:%ACTION_ID%}";

export function renderPromptMarker(template: string, actionId: bigint | number): string {
  if (!template.includes(PROMPT_MARKER_PLACEHOLDER)) {
    throw new Error(`prompt marker template must contain ${PROMPT_MARKER_PLACEHOLDER}`);
  }
  return template.replace(PROMPT_MARKER_PLACEHOLDER, String(actionId));
}

/** Prefix shared by all action markers for this template (used to detect adjacent actions in sessions). */
export function promptMarkerPrefix(template: string = DEFAULT_PROMPT_MARKER_TEMPLATE): string {
  const idx = template.indexOf(PROMPT_MARKER_PLACEHOLDER);
  if (idx === -1) {
    throw new Error(`prompt marker template must contain ${PROMPT_MARKER_PLACEHOLDER}`);
  }
  return template.slice(0, idx);
}
