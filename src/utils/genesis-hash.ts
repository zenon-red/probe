import { readFile } from "node:fs/promises";
import { hash as canonicalHash } from "canonical-json/hash";

export function genesisHashFromManifest(manifest: unknown): string {
  return canonicalHash(manifest, "sha256");
}

export async function genesisHashFromJsonFile(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const manifest = JSON.parse(raw) as unknown;
  return genesisHashFromManifest(manifest);
}
