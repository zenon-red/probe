import { genesisHashFromManifest } from "~/utils/genesis-hash.js";
import { validateSkillsSpec } from "~/utils/genesis-skills.js";
import { PROMPT_MARKER_PLACEHOLDER } from "~/utils/prompt-marker.js";

export const DEPLOYED_SCHEMA_VERSION = 1;
export { PROMPT_MARKER_PLACEHOLDER };
const MAX_PROMPT_MARKER_LEN = 120;

const ALLOWED_TOP_LEVEL = new Set([
  "schemaVersion",
  "genesis",
  "minProbeVersion",
  "org",
  "endpoints",
  "skills",
  "messaging",
  "dispatch",
]);

const ROUTE_EXPECTED_KIND: Record<string, string> = {
  authorized_directive: "inbox",
  continue_owned_task: "execute_task",
  assign_open_task: "execute_task",
  review_task: "review_task",
  validate_review: "validate_review",
  vote: "vote",
  proposal_scout: "propose",
  project_setup: "project_setup",
  create_tasks: "create_tasks",
  merge_ready_task: "merge_ready_task",
  review_discovery: "review_discovery",
};

export type ParsedGenesisManifest = {
  genesisHash: string;
  genesisId: string;
  genesisVersion: string;
  genesisUrl?: string;
  minProbeVersion?: string;
  githubOrg: string;
  orgName: string;
  promptMarker: string;
  skillsSource: string;
  skillsRef: string;
  issuer: string;
  spacetimeHost: string;
  spacetimeModule: string;
  feedChannels: string[];
  rawJson: string;
};

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must not be empty`);
  }
  return value;
}

function rejectUnknownTopLevel(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      throw new Error(`Unknown manifest key: ${key}`);
    }
  }
}

function validateGithubOrg(org: string): void {
  requireString(org, "org.githubOrg");
  if (org.length > 39) {
    throw new Error("org.githubOrg exceeds GitHub login length limit");
  }
  const first = org[0];
  if (!first || !/[A-Za-z0-9]/.test(first)) {
    throw new Error("org.githubOrg must start with an ASCII letter or digit");
  }
  for (const ch of org.slice(1)) {
    if (!/[A-Za-z0-9-]/.test(ch)) {
      throw new Error("org.githubOrg may contain only ASCII letters, digits, and hyphens");
    }
  }
  if (org.endsWith("-")) {
    throw new Error("org.githubOrg must not end with a hyphen");
  }
}

function validatePromptMarker(marker: string): void {
  requireString(marker, "org.promptMarker");
  if (marker.length > MAX_PROMPT_MARKER_LEN) {
    throw new Error(`org.promptMarker exceeds max length ${MAX_PROMPT_MARKER_LEN}`);
  }
  if (marker !== marker.trim()) {
    throw new Error("org.promptMarker must not have leading or trailing whitespace");
  }
  if (marker.includes("\n") || marker.includes("\r")) {
    throw new Error("org.promptMarker must be a single line");
  }
  const count = marker.split(PROMPT_MARKER_PLACEHOLDER).length - 1;
  if (count !== 1) {
    throw new Error(
      `org.promptMarker must contain exactly one ${PROMPT_MARKER_PLACEHOLDER} placeholder`,
    );
  }
  if (marker.indexOf(PROMPT_MARKER_PLACEHOLDER) === 0) {
    throw new Error(
      `org.promptMarker must include a non-empty prefix before ${PROMPT_MARKER_PLACEHOLDER}`,
    );
  }
}

function validateRoutes(routesObj: Record<string, unknown>): void {
  for (const [routeKey, entryRaw] of Object.entries(routesObj)) {
    const expectedKind = ROUTE_EXPECTED_KIND[routeKey];
    if (!expectedKind) {
      throw new Error(`Unknown dispatch route key: ${routeKey}`);
    }
    const entry = requireObject(entryRaw, `dispatch.routes.${routeKey}`);
    const kind = requireString(entry.kind, `dispatch.routes.${routeKey}.kind`);
    if (kind !== expectedKind) {
      throw new Error(`dispatch.routes.${routeKey}.kind must be '${expectedKind}' (got '${kind}')`);
    }
    requireString(entry.capability, `dispatch.routes.${routeKey}.capability`);
    requireString(entry.skill, `dispatch.routes.${routeKey}.skill`);
  }
}

export function parseGenesisManifestJson(manifestJson: string): ParsedGenesisManifest {
  let value: unknown;
  try {
    value = JSON.parse(manifestJson);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const root = requireObject(value, "Genesis manifest");
  rejectUnknownTopLevel(root);

  const schemaVersion = root.schemaVersion;
  if (schemaVersion !== DEPLOYED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${String(schemaVersion)} (deployed version is ${DEPLOYED_SCHEMA_VERSION})`,
    );
  }

  const genesis = requireObject(root.genesis, "genesis");
  const org = requireObject(root.org, "org");
  const endpoints = requireObject(root.endpoints, "endpoints");
  const skills = requireObject(root.skills, "skills");
  const messaging = requireObject(root.messaging, "messaging");
  const dispatch = requireObject(root.dispatch, "dispatch");

  const githubOrg = requireString(org.githubOrg, "org.githubOrg");
  validateGithubOrg(githubOrg);
  const promptMarker = requireString(org.promptMarker, "org.promptMarker");
  validatePromptMarker(promptMarker);
  const orgName = requireString(org.name, "org.name");

  const genesisId = requireString(genesis.id, "genesis.id");
  const genesisVersion = requireString(genesis.version, "genesis.version");
  const genesisUrl =
    genesis.url === undefined ? undefined : requireString(genesis.url, "genesis.url");

  const issuer = requireString(endpoints.issuer, "endpoints.issuer");
  const spacetimeHost = requireString(endpoints.spacetimeHost, "endpoints.spacetimeHost");
  const spacetimeModule = requireString(endpoints.spacetimeModule, "endpoints.spacetimeModule");
  const skillsSource = requireString(skills.source, "skills.source");
  const skillsRef = requireString(skills["ref"], "skills.ref");
  const skillsSpec = validateSkillsSpec(skillsSource, skillsRef);

  const feedChannelsRaw = messaging.feedChannels;
  if (!Array.isArray(feedChannelsRaw) || feedChannelsRaw.length === 0) {
    throw new Error("messaging.feedChannels must not be empty");
  }
  const feedChannels = feedChannelsRaw.map((c, i) =>
    requireString(c, `messaging.feedChannels[${i}]`),
  );

  const routesObj = requireObject(dispatch.routes, "dispatch.routes");
  validateRoutes(routesObj);

  const minProbeVersion =
    root.minProbeVersion === undefined
      ? undefined
      : requireString(root.minProbeVersion, "minProbeVersion");

  const genesisHash = genesisHashFromManifest(value);

  return {
    genesisHash,
    genesisId,
    genesisVersion,
    genesisUrl,
    minProbeVersion,
    githubOrg,
    orgName,
    promptMarker,
    skillsSource: skillsSpec.source,
    skillsRef: skillsSpec.ref,
    issuer,
    spacetimeHost,
    spacetimeModule,
    feedChannels,
    rawJson: manifestJson,
  };
}

export async function loadGenesisManifestFromSource(source: string): Promise<{
  manifestJson: string;
  parsed: ParsedGenesisManifest;
  persistedSource: string;
}> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`Failed to fetch genesis URL: HTTP ${res.status}`);
    }
    const manifestJson = await res.text();
    const parsed = parseGenesisManifestJson(manifestJson);
    return { manifestJson, parsed, persistedSource: source };
  }

  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const path = resolve(source);
  const manifestJson = await readFile(path, "utf8");
  const parsed = parseGenesisManifestJson(manifestJson);
  return { manifestJson, parsed, persistedSource: path };
}
