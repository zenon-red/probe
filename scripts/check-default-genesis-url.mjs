#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const fromEnv = process.env.PROBE_DEFAULT_GENESIS_URL?.trim();
const fromPkg = pkg.probe?.defaultGenesisUrl?.trim();
const repoUrl = pkg.repository?.url ?? "";
const cleaned = repoUrl.replace(/^git\+/, "").replace(/\.git$/, "");
const match = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);

function expectedFromRepo() {
  if (!match) return null;
  const [, org, repo] = match;
  if (pkg.name !== `@${org}/${repo}`) return null;
  return `https://raw.githubusercontent.com/${org}/${repo}/main/orgs/${org}/genesis.json`;
}

const expected = fromEnv ?? fromPkg ?? expectedFromRepo();
if (!expected) {
  console.error(
    `[check-default-genesis-url] FAIL: package.json#name=${JSON.stringify(pkg.name)} ` +
      `and package.json#repository.url=${JSON.stringify(repoUrl)} cannot be mapped to a default genesis URL.`,
  );
  console.error(
    `Set package.json#probe.defaultGenesisUrl=<url> or PROBE_DEFAULT_GENESIS_URL=<url> in the environment.`,
  );
  process.exit(1);
}

const distCheckPath = join(here, "..", "dist", "index.js");
if (!existsSync(distCheckPath)) {
  console.error(
    `[check-default-genesis-url] FAIL: dist/index.js not built yet (run \`npm run build\` first).`,
  );
  process.exit(1);
}

const distContents = readFileSync(distCheckPath, "utf8");
if (!distContents.includes(expected)) {
  console.error(
    `[check-default-genesis-url] FAIL: dist/index.js does not contain expected URL ${expected}.`,
  );
  console.error(
    `Rebuild with \`npm run build\` after setting PROBE_DEFAULT_GENESIS_URL or changing package.json.`,
  );
  process.exit(1);
}

console.log(`[check-default-genesis-url] OK: dist contains ${expected}`);
