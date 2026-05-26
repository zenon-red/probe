import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { genesisHashFromJsonFile, genesisHashFromManifest } from "../../src/utils/genesis-hash.js";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures/genesis");

async function expectedHash(name: string): Promise<string> {
  const text = await readFile(join(FIXTURES_DIR, `${name}.expected-hash.txt`), "utf8");
  return text.trim();
}

describe("genesis hash (canonical-json)", () => {
  test("zenon-red-lab matches Nexus golden vector", async () => {
    const path = join(FIXTURES_DIR, "zenon-red-lab.manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    expect(genesisHashFromManifest(manifest)).toBe(await expectedHash("zenon-red-lab"));
  });

  test("zenon-red matches Nexus golden vector", async () => {
    const path = join(FIXTURES_DIR, "zenon-red.manifest.json");
    expect(await genesisHashFromJsonFile(path)).toBe(await expectedHash("zenon-red"));
  });
});
