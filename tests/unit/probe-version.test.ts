import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { probeDescription, probeVersion } from "../../src/probe-version.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
) as { version: string; description: string };

test("probeVersion reads semver from package root in dev", () => {
  assert.equal(probeVersion(), pkg.version);
});

test("probeDescription reads description from package root in dev", () => {
  assert.equal(probeDescription(), pkg.description);
});
