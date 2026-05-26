import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

test("dist CLI --version matches package.json", () => {
  const output = execFileSync("node", [join(repoRoot, "dist/index.js"), "--version"], {
    encoding: "utf8",
  }).trim();
  assert.equal(output, pkg.version);
});
