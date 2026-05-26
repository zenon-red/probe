import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

type PackageMeta = { version?: string; description?: string };

const UNKNOWN_VERSION = "0.0.0";

let cachedMeta: PackageMeta | null | undefined;
let cachedVersion: string | undefined;
let cachedDescription: string | undefined;

function readPackageMeta(): PackageMeta | null {
  if (cachedMeta !== undefined) return cachedMeta;

  const base = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(base, "..", "package.json"), join(base, "../..", "package.json")];

  for (const path of candidates) {
    try {
      cachedMeta = require(path) as PackageMeta;
      return cachedMeta;
    } catch {
      // try next candidate
    }
  }

  cachedMeta = null;
  return cachedMeta;
}

function readBuildInjectedVersion(): string | undefined {
  try {
    return __PROBE_VERSION__;
  } catch {
    return undefined;
  }
}

function readBuildInjectedDescription(): string | undefined {
  try {
    return __PROBE_DESCRIPTION__;
  } catch {
    return undefined;
  }
}

/** Canonical Probe semver for CLI metadata, upgrades, and genesis gates. */
export function probeVersion(): string {
  if (cachedVersion) return cachedVersion;

  const embedded = readBuildInjectedVersion();
  if (embedded) {
    cachedVersion = embedded;
    return cachedVersion;
  }

  const meta = readPackageMeta();
  if (meta?.version) {
    cachedVersion = meta.version;
    return cachedVersion;
  }

  if (process.env.npm_package_version) {
    cachedVersion = process.env.npm_package_version;
    return cachedVersion;
  }

  cachedVersion = UNKNOWN_VERSION;
  return cachedVersion;
}

export function probeDescription(): string {
  if (cachedDescription) return cachedDescription;

  const embedded = readBuildInjectedDescription();
  if (embedded) {
    cachedDescription = embedded;
    return cachedDescription;
  }

  const meta = readPackageMeta();
  cachedDescription = meta?.description ?? probeDescriptionFallback();
  return cachedDescription;
}

function probeDescriptionFallback(): string {
  return "All-in-one CLI tool for interacting with Nexus.";
}
