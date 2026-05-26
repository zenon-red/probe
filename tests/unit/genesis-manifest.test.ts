import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGenesisManifestJson } from "../../src/utils/genesis-manifest.js";

const fixturesDir = join(import.meta.dirname, "../../../nexus/stdb/fixtures/genesis");

describe("genesis manifest parse", () => {
  test("minimal-lab fixture parses", async () => {
    const raw = await readFile(join(fixturesDir, "minimal-lab.manifest.json"), "utf8");
    const expected = (
      await readFile(join(fixturesDir, "minimal-lab.expected-hash.txt"), "utf8")
    ).trim();
    const parsed = parseGenesisManifestJson(raw);
    expect(parsed.genesisHash).toBe(expected);
    expect(parsed.githubOrg).toBe("zenon-red-lab");
    expect(parsed.feedChannels).toContain("general");
  });

  test("rejects unknown top-level key", () => {
    expect(() => parseGenesisManifestJson('{"schemaVersion":1,"extra":true}')).toThrow(
      /Unknown manifest key/,
    );
  });

  test("rejects prompt markers without a stable prefix", async () => {
    const raw = await readFile(join(fixturesDir, "minimal-lab.manifest.json"), "utf8");
    const manifest = JSON.parse(raw);
    manifest.org.promptMarker = "%ACTION_ID%";
    expect(() => parseGenesisManifestJson(JSON.stringify(manifest))).toThrow(/non-empty prefix/);
  });
});
