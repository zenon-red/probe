#!/usr/bin/env node
/**
 * One-off Hermes token telemetry smoke.
 * Harness runs under Bun; extraction uses node:sqlite (same as probe production).
 *
 * Usage: node scripts/smoke-hermes-tokens.mjs
 * Prereq: bun build src/daemon/harness-usage.ts --outfile=/tmp/harness-usage.mjs --target=node --format=esm
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const probeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionId = (Date.now() % 1_000_000) + 900_000;
const runStartedAt = new Date().toISOString();

const harnessScript = `
import { getConfig } from "./src/utils/config.ts";
import { resolveHarness } from "./src/daemon/loop.ts";
import { runHarness } from "./src/daemon/harness-runner.ts";
import { buildActionPrompt } from "./src/utils/prompt-builder.ts";
import { actionCorrelationFlag } from "./src/utils/action-prompts.ts";

const actionId = ${actionId};
const config = await getConfig();
const harness = resolveHarness({ harnessArg: "hermes", config });
const prompt = buildActionPrompt({
  id: actionId,
  kind: "SmokeTest",
  skill: "smoke",
  instruction: "Reply with exactly: smoke-ok. Do not use tools.",
  route: "AuthorizedDirective",
});
const run = await runHarness({ harness, prompt, timeoutSecs: 300 });
console.log(JSON.stringify({
  actionId,
  marker: actionCorrelationFlag(actionId),
  runStartedAt: ${JSON.stringify(runStartedAt)},
  harness: run,
}));
`;

const harness = spawnSync("bun", ["-e", harnessScript], {
  cwd: probeRoot,
  encoding: "utf8",
  timeout: 320_000,
});
if (harness.status !== 0) {
  console.error(harness.stderr || harness.stdout);
  process.exit(harness.status ?? 1);
}

const { marker, harness: run } = JSON.parse(harness.stdout.trim().split("\n").pop());

spawnSync(
  "bun",
  [
    "build",
    "src/daemon/harness-usage/index.ts",
    "--outfile=/tmp/harness-usage.mjs",
    "--target=node",
    "--format=esm",
  ],
  { cwd: probeRoot, stdio: "inherit" },
);

const { extractHarnessUsage } = await import("file:///tmp/harness-usage.mjs");
const usage = extractHarnessUsage("hermes", actionId, new Date(runStartedAt));

console.log("actionId:", actionId);
console.log("marker:", marker);
console.log("harness:", run);
console.log("tokens:", usage);
