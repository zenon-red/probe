import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessType } from "~/types/config.js";
import { splitCommandLine, type CommandParts } from "../spawn.js";
import { HARNESS_ACP_COMMANDS } from "./registry.js";

const BUILT_IN_PACKAGES = {
  codex: {
    packageName: "@agentclientprotocol/codex-acp",
    preferredBinName: "codex-acp",
  },
  claude: {
    packageName: "@agentclientprotocol/claude-agent-acp",
    preferredBinName: "claude-agent-acp",
  },
} as const;

function resolvePackageRoot(packageName: string): string {
  const segments = packageName.split("/");
  let cursor = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const candidateRoot = path.join(cursor, "node_modules", ...segments);
    const manifestPath = path.join(candidateRoot, "package.json");
    if (fs.existsSync(manifestPath)) {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string };
      if (parsed.name === packageName) {
        return candidateRoot;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`Built-in agent package not found: ${packageName}`);
    }
    cursor = parent;
  }
}

function resolveInstalledBin(harness: "claude" | "codex"): CommandParts | undefined {
  const spec = BUILT_IN_PACKAGES[harness];
  const packageRoot = resolvePackageRoot(spec.packageName);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>;
  };

  let relativeBin: string | undefined;
  if (typeof manifest.bin === "string") {
    relativeBin = manifest.bin;
  } else if (manifest.bin) {
    relativeBin =
      manifest.bin[spec.preferredBinName] ??
      (Object.keys(manifest.bin).length === 1 ? Object.values(manifest.bin)[0] : undefined);
  }
  if (!relativeBin) {
    return undefined;
  }

  const binPath = path.resolve(packageRoot, relativeBin);
  if (!fs.existsSync(binPath)) {
    return undefined;
  }

  return { command: process.execPath, args: [binPath] };
}

export function resolveHarnessAgentLaunch(
  harness: HarnessType,
  customCommand?: string,
): CommandParts {
  if (harness === "claude" || harness === "codex") {
    const installed = resolveInstalledBin(harness);
    if (installed) {
      return installed;
    }
  }

  if (harness === "custom") {
    if (!customCommand?.trim()) {
      throw new Error("custom harness requires harnessCommand in config");
    }
    return splitCommandLine(customCommand.trim());
  }

  return splitCommandLine(HARNESS_ACP_COMMANDS[harness]);
}
