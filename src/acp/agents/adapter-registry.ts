import { arch, homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { HarnessType } from "~/types/config.js";
import type { CommandParts } from "../spawn.js";
import { commandExists } from "~/utils/system.js";

const execFileAsync = promisify(execFile);

export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export const ADAPTER_REGISTRY = {
  claude: { registryId: "claude-acp", fallbackBin: "claude-agent-acp" },
  codex: { registryId: "codex-acp", fallbackBin: "codex-acp" },
  pi: { registryId: "pi-acp", fallbackBin: "pi-acp" },
} as const;

export type AdapterHarness = keyof typeof ADAPTER_REGISTRY;

export function isAdapterHarness(harness: HarnessType): harness is AdapterHarness {
  return harness in ADAPTER_REGISTRY;
}

export type RegistryNpxDistribution = {
  package: string;
  args?: string[];
  env?: Record<string, string>;
};

export type RegistryBinaryPlatform = {
  archive: string;
  cmd: string;
  args?: string[];
};

export type RegistryAgentRecord = {
  id: string;
  name: string;
  version: string;
  distribution?: {
    npx?: RegistryNpxDistribution;
    binary?: Record<string, RegistryBinaryPlatform>;
  };
};

export type RegistryDocument = {
  version: string;
  agents: RegistryAgentRecord[];
};

export type AdapterMetadata = {
  registryId: string;
  version: string;
  source: "registry" | "fallback";
  npx?: RegistryNpxDistribution;
  binary?: RegistryBinaryPlatform;
  remediation: string;
};

export type ResolvedAdapterLaunch = CommandParts & {
  registryId: string;
  version: string;
  source: "cache" | "path" | "registry-binary" | "npx" | "fallback-npx";
  remediation: string;
};

export type HarnessResolveCache = {
  version: number;
  entries: Record<
    string,
    {
      registryId: string;
      version: string;
      command: string;
      args: string[];
      source: string;
    }
  >;
};

const registryNpxDistributionSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const registryBinaryPlatformSchema = z.object({
  archive: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional(),
});

const registryAgentRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  distribution: z
    .object({
      npx: registryNpxDistributionSchema.optional(),
      binary: z.record(registryBinaryPlatformSchema).optional(),
    })
    .optional(),
});

const registryDocumentSchema = z.object({
  version: z.string().min(1),
  agents: z.array(registryAgentRecordSchema),
});

const PINNED_FALLBACK: Record<string, RegistryAgentRecord> = {
  "claude-acp": {
    id: "claude-acp",
    name: "Claude Agent",
    version: "0.39.0",
    distribution: {
      npx: { package: "@agentclientprotocol/claude-agent-acp@0.39.0" },
    },
  },
  "codex-acp": {
    id: "codex-acp",
    name: "Codex CLI",
    version: "0.15.0",
    distribution: {
      npx: { package: "@zed-industries/codex-acp@0.15.0" },
    },
  },
  "pi-acp": {
    id: "pi-acp",
    name: "Pi ACP",
    version: "0.0.27",
    distribution: {
      npx: { package: "pi-acp@0.0.27" },
    },
  },
};

export function probeHomeDir(): string {
  return join(homedir(), ".probe");
}

export function harnessResolveCachePath(): string {
  return join(probeHomeDir(), "harness-resolve.json");
}

export function registryCachePath(): string {
  return join(probeHomeDir(), "acp-registry-cache.json");
}

export function platformBinaryKey(): string | undefined {
  const p = platform();
  const a = arch();
  if (p === "linux" && a === "x64") return "linux-x86_64";
  if (p === "linux" && a === "arm64") return "linux-aarch64";
  if (p === "darwin" && a === "arm64") return "darwin-aarch64";
  if (p === "darwin" && a === "x64") return "darwin-x86_64";
  if (p === "win32" && a === "x64") return "windows-x86_64";
  if (p === "win32" && a === "arm64") return "windows-aarch64";
  return undefined;
}

export function remediationFromNpx(npx: RegistryNpxDistribution): string {
  return `npm i -g ${npx.package}`;
}

export async function readHarnessResolveCache(): Promise<HarnessResolveCache> {
  const path = harnessResolveCachePath();
  if (!existsSync(path)) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as HarnessResolveCache;
    return raw.version === 1 ? raw : { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

export async function writeHarnessResolveCache(cache: HarnessResolveCache): Promise<void> {
  const path = harnessResolveCachePath();
  await mkdir(probeHomeDir(), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export async function fetchRegistryDocument(options?: {
  fetchFn?: typeof fetch;
  readCacheFn?: () => Promise<RegistryDocument | null>;
  writeCacheFn?: (doc: RegistryDocument) => Promise<void>;
}): Promise<{ doc: RegistryDocument; source: "registry" | "cache" | "fallback" }> {
  const fetchFn = options?.fetchFn ?? fetch;
  const readCache = options?.readCacheFn ?? readRegistryCache;
  const writeCache = options?.writeCacheFn ?? writeRegistryCache;

  try {
    const response = await fetchFn(REGISTRY_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`registry HTTP ${response.status}`);
    }
    const doc = registryDocumentSchema.parse(await response.json());
    await writeCache(doc);
    return { doc, source: "registry" };
  } catch {
    const cached = await readCache();
    if (cached) {
      return { doc: cached, source: "cache" };
    }
    return {
      doc: { version: "fallback", agents: Object.values(PINNED_FALLBACK) },
      source: "fallback",
    };
  }
}

async function readRegistryCache(): Promise<RegistryDocument | null> {
  const path = registryCachePath();
  if (!existsSync(path)) return null;
  try {
    return registryDocumentSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function writeRegistryCache(doc: RegistryDocument): Promise<void> {
  await mkdir(probeHomeDir(), { recursive: true });
  await writeFile(registryCachePath(), `${JSON.stringify(doc)}\n`, "utf8");
}

export function lookupRegistryAgent(
  doc: RegistryDocument,
  registryId: string,
): RegistryAgentRecord | undefined {
  return doc.agents.find((agent) => agent.id === registryId) ?? PINNED_FALLBACK[registryId];
}

export function metadataFromAgent(
  agent: RegistryAgentRecord,
  source: "registry" | "fallback",
): AdapterMetadata {
  const platformKey = platformBinaryKey();
  const binary = platformKey ? agent.distribution?.binary?.[platformKey] : undefined;
  const npx = agent.distribution?.npx;
  const remediation = npx
    ? remediationFromNpx(npx)
    : `Install ${agent.id}@${agent.version} from the ACP registry`;

  return {
    registryId: agent.id,
    version: agent.version,
    source,
    npx,
    binary,
    remediation,
  };
}

export async function resolveAdapterMetadata(
  harness: AdapterHarness,
  options?: { fetchFn?: typeof fetch },
): Promise<AdapterMetadata> {
  const spec = ADAPTER_REGISTRY[harness];
  const { doc, source } = await fetchRegistryDocument(options);
  const agent = lookupRegistryAgent(doc, spec.registryId);
  if (!agent) {
    const fallback = PINNED_FALLBACK[spec.registryId]!;
    return metadataFromAgent(fallback, "fallback");
  }
  return metadataFromAgent(agent, source === "fallback" ? "fallback" : "registry");
}

function launchFromNpx(npx: RegistryNpxDistribution): CommandParts {
  const extraArgs = npx.args ?? [];
  return { command: "npx", args: ["-y", npx.package, ...extraArgs] };
}

async function resolveGlobalExecutable(binName: string): Promise<CommandParts | undefined> {
  if (commandExists(binName)) {
    return { command: binName, args: [] };
  }
  try {
    const { stdout } = await execFileAsync("npm", ["root", "-g"], { timeout: 5_000 });
    const globalRoot = stdout.trim();
    const candidate = join(globalRoot, ".bin", binName);
    if (existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function resolveAdapterLaunch(
  harness: AdapterHarness,
  options?: {
    fetchFn?: typeof fetch;
    readCacheFn?: () => Promise<HarnessResolveCache>;
    writeCacheFn?: (cache: HarnessResolveCache) => Promise<void>;
  },
): Promise<ResolvedAdapterLaunch> {
  const metadata = await resolveAdapterMetadata(harness, options);
  const readCache = options?.readCacheFn ?? readHarnessResolveCache;
  const writeCache = options?.writeCacheFn ?? writeHarnessResolveCache;
  const cache = await readCache();
  const cached = cache.entries[harness];
  if (
    cached &&
    cached.registryId === metadata.registryId &&
    cached.version === metadata.version &&
    isCachedLaunchUsable(cached.command)
  ) {
    return {
      command: cached.command,
      args: cached.args,
      registryId: metadata.registryId,
      version: metadata.version,
      source: "cache",
      remediation: metadata.remediation,
    };
  }

  const binName = ADAPTER_REGISTRY[harness].fallbackBin;
  const onPath = await resolveGlobalExecutable(binName);
  if (onPath) {
    await persistCache(writeCache, cache, harness, metadata, onPath, "path");
    return {
      ...onPath,
      registryId: metadata.registryId,
      version: metadata.version,
      source: "path",
      remediation: metadata.remediation,
    };
  }

  if (metadata.npx) {
    const npxLaunch = launchFromNpx(metadata.npx);
    await persistCache(writeCache, cache, harness, metadata, npxLaunch, "npx");
    return {
      ...npxLaunch,
      registryId: metadata.registryId,
      version: metadata.version,
      source: "npx",
      remediation: metadata.remediation,
    };
  }

  throw new Error(
    `Adapter ${metadata.registryId}@${metadata.version} is not resolvable (${metadata.source}). ${metadata.remediation}`,
  );
}

function isCachedLaunchUsable(command: string): boolean {
  if (command === "npx") return commandExists("npx");
  if (command.includes("/") || command.includes("\\") || command.startsWith(".")) {
    return existsSync(command);
  }
  return commandExists(command);
}

async function persistCache(
  writeCache: (cache: HarnessResolveCache) => Promise<void>,
  cache: HarnessResolveCache,
  harness: AdapterHarness,
  metadata: AdapterMetadata,
  launch: CommandParts,
  source: string,
): Promise<void> {
  cache.entries[harness] = {
    registryId: metadata.registryId,
    version: metadata.version,
    command: launch.command,
    args: launch.args,
    source,
  };
  await writeCache(cache);
}

export async function installAdapterFromMetadata(
  metadata: AdapterMetadata,
): Promise<{ command: string; args: string[] }> {
  if (!metadata.npx) {
    throw new Error(`No npx distribution for ${metadata.registryId}`);
  }
  return { command: "npm", args: ["i", "-g", metadata.npx.package] };
}
