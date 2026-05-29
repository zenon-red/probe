import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGenesisManifestJson } from "../../src/utils/genesis-manifest.js";

const fixturesDir = join(import.meta.dirname, "../fixtures/genesis");

describe("genesis manifest parse", () => {
  test("zenon-red-lab fixture parses", async () => {
    const raw = await readFile(join(fixturesDir, "zenon-red-lab.manifest.json"), "utf8");
    const expected = (
      await readFile(join(fixturesDir, "zenon-red-lab.expected-hash.txt"), "utf8")
    ).trim();
    const parsed = parseGenesisManifestJson(raw);
    expect(parsed.genesisHash).toBe(expected);
    expect(parsed.githubOrg).toBe("zenon-red-lab");
    expect(parsed.feedChannels).toContain("general");
  });

  test("parses optional openspec.version", async () => {
    const raw = await readFile(join(fixturesDir, "zenon-red-openspec.manifest.json"), "utf8");
    const parsed = parseGenesisManifestJson(raw);
    expect(parsed.openspecVersion).toBe("1.3.1");
  });

  test("rejects openspec semver ranges", async () => {
    const raw = await readFile(join(fixturesDir, "zenon-red-lab.manifest.json"), "utf8");
    const manifest = JSON.parse(raw);
    manifest.openspec = { version: "^1.3.0" };
    expect(() => parseGenesisManifestJson(JSON.stringify(manifest))).toThrow(/exact semver/);
  });

  test("rejects unknown top-level key", () => {
    expect(() => parseGenesisManifestJson('{"schemaVersion":1,"extra":true}')).toThrow(
      /Unknown manifest key/,
    );
  });

  test("rejects prompt markers without a stable prefix", async () => {
    const raw = await readFile(join(fixturesDir, "zenon-red-lab.manifest.json"), "utf8");
    const manifest = JSON.parse(raw);
    manifest.org.promptMarker = "%ACTION_ID%";
    expect(() => parseGenesisManifestJson(JSON.stringify(manifest))).toThrow(/non-empty prefix/);
  });
});
