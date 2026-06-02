import { existsSync, readFileSync } from "node:fs";

type ProbePackageMetadata = {
  name?: string;
  repository?: { url?: string };
  probe?: { defaultGenesisUrl?: string };
};

export const SOURCE_FALLBACK_DEFAULT_GENESIS_URL =
  "https://raw.githubusercontent.com/zenon-red/nexus/main/orgs/zenon-red/genesis.json";

export function deriveDefaultGenesisUrlFromPackage(
  pkg: ProbePackageMetadata,
  envUrl = process.env.PROBE_DEFAULT_GENESIS_URL,
): string {
  const fromEnv = envUrl?.trim();
  if (fromEnv) return fromEnv;

  const fromPkg = pkg.probe?.defaultGenesisUrl?.trim();
  if (fromPkg) return fromPkg;

  const repoUrl = pkg.repository?.url ?? "";
  const cleaned = repoUrl.replace(/^git\+/, "").replace(/\.git$/, "");
  const match = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(
      `Cannot derive default genesis URL: package.json#repository.url is ${JSON.stringify(repoUrl)}. ` +
        "Set package.json#probe.defaultGenesisUrl or PROBE_DEFAULT_GENESIS_URL explicitly.",
    );
  }

  const [, org, repo] = match;
  if (pkg.name !== `@${org}/${repo}`) {
    throw new Error(
      `Refusing to derive default genesis URL: package.json#name ${JSON.stringify(pkg.name)} ` +
        `does not match repository org/repo @${org}/${repo}. ` +
        "Set package.json#probe.defaultGenesisUrl or PROBE_DEFAULT_GENESIS_URL explicitly.",
    );
  }

  return `https://raw.githubusercontent.com/${org}/${repo}/main/orgs/${org}/genesis.json`;
}

function readBuildInjectedDefaultGenesisUrl(): string | undefined {
  try {
    return __PROBE_DEFAULT_GENESIS_URL__;
  } catch {
    return undefined;
  }
}

export function resolveDefaultGenesisUrl(): string {
  const injected = readBuildInjectedDefaultGenesisUrl()?.trim();
  if (injected) return injected;

  try {
    const pkg = readNearestPackageMetadata();
    if (pkg) return deriveDefaultGenesisUrlFromPackage(pkg);
  } catch {
    // Source-mode fallback keeps tests/dev usable even outside a package checkout.
  }
  return SOURCE_FALLBACK_DEFAULT_GENESIS_URL;
}

function readNearestPackageMetadata(): ProbePackageMetadata | undefined {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return JSON.parse(readFileSync(candidate, "utf8")) as ProbePackageMetadata;
  }

  return undefined;
}
