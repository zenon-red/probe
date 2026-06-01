import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Session files may be created slightly before daemon runStartedAt (clock / fs mtime). */
export const RUN_STARTED_MTIME_SLACK_MS = 15_000;

export function newestFileWithMarker(
  root: string,
  marker: string,
  runStartedAtMs: number,
  extensions?: string[],
): string | undefined {
  let best: { path: string; mtime: number } | undefined;

  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (extensions && !extensions.some((ext) => path.endsWith(ext))) {
        continue;
      }
      try {
        const stat = statSync(path);
        const earliestMtime = runStartedAtMs - RUN_STARTED_MTIME_SLACK_MS;
        if (stat.mtimeMs < earliestMtime) {
          continue;
        }
        const sample = readFileSync(path, "utf8").slice(0, 256_000);
        if (!sample.includes(marker)) {
          continue;
        }
        if (!best || stat.mtimeMs > best.mtime) {
          best = { path, mtime: stat.mtimeMs };
        }
      } catch {}
    }
  };

  visit(root);
  return best?.path;
}

export async function sumPiJsonlUsage(
  path: string,
  marker: string,
  markerPrefix: string,
): Promise<{ inputTokens: number; outputTokens: number }> {
  let inputTokens = 0;
  let outputTokens = 0;
  let inScope = false;

  const rl = createInterface({ input: createReadStream(path) });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    if (line.includes(marker)) {
      inScope = true;
      continue;
    }
    if (inScope && markerPrefix && line.includes(markerPrefix) && !line.includes(marker)) {
      break;
    }
    if (!inScope) {
      continue;
    }
    try {
      const row = JSON.parse(line) as {
        message?: {
          usage?: {
            input?: number;
            output?: number;
            input_tokens?: number;
            output_tokens?: number;
          };
        };
        usage?: {
          input?: number;
          output?: number;
          input_tokens?: number;
          output_tokens?: number;
        };
      };
      const usage = row.message?.usage ?? row.usage;
      if (!usage) {
        continue;
      }
      inputTokens +=
        num(usage.input ?? usage.input_tokens) +
        num((usage as { cacheRead?: number; cache_read?: number }).cacheRead) +
        num((usage as { cacheRead?: number; cache_read?: number }).cache_read);
      outputTokens += num(usage.output ?? usage.output_tokens);
    } catch {}
  }

  return { inputTokens, outputTokens };
}

export function sumScopedJsonlUsage(
  path: string,
  marker: string,
  markerPrefix: string,
): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  let inScope = false;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (line.includes(marker)) {
      inScope = true;
      continue;
    }
    if (inScope && markerPrefix && line.includes(markerPrefix) && !line.includes(marker)) {
      break;
    }
    if (!inScope) {
      continue;
    }
    try {
      const row = JSON.parse(line) as {
        usage?: {
          input?: number;
          output?: number;
          input_tokens?: number;
          output_tokens?: number;
        };
        metadata?: {
          usage?: {
            input?: number;
            output?: number;
            input_tokens?: number;
            output_tokens?: number;
          };
        };
      };
      const usage = row.usage ?? row.metadata?.usage;
      if (!usage) {
        continue;
      }
      inputTokens +=
        num(usage.input ?? usage.input_tokens) +
        num((usage as { cacheRead?: number; cache_read?: number }).cacheRead) +
        num((usage as { cacheRead?: number; cache_read?: number }).cache_read);
      outputTokens += num(usage.output ?? usage.output_tokens);
    } catch {}
  }

  return { inputTokens, outputTokens };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
