import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MARKER_PREFIX } from "./types.js";

export type FileMatch = { path: string; mtimeMs: number };

export function readJsonFile(path: string): unknown {
  let content = "";
  forEachLineSync(path, (line) => {
    content += line;
  });
  return JSON.parse(content);
}

export function findNewestJsonlWithMarker(
  root: string,
  marker: string,
  minMtimeMs: number,
): string | null {
  return (
    findNewestFileWithMarker(root, marker, minMtimeMs, (path) => /\.jsonl?$/i.test(path))?.path ??
    null
  );
}

export function findNewestFileWithMarker(
  root: string,
  marker: string,
  minMtimeMs: number,
  acceptPath: (path: string) => boolean,
): FileMatch | null {
  let best: FileMatch | null = null;
  for (const path of walkFiles(root)) {
    if (!acceptPath(path)) continue;
    try {
      const fileStat = statSync(path);
      if (fileStat.mtimeMs < minMtimeMs) continue;
      if (!fileContainsMarker(path, marker)) continue;
      if (!best || fileStat.mtimeMs > best.mtimeMs) {
        best = { path, mtimeMs: fileStat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return best;
}

export function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 10) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...walkFiles(full, depth + 1));
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

export function listFiles(dir: string): string[] {
  return walkFiles(dir).filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

export function fileContainsMarker(path: string, marker: string): boolean {
  let found = false;
  forEachLineSync(path, (line) => {
    if (line.includes(marker)) {
      found = true;
      return false;
    }
  });
  return found;
}

export function forEachLineSync(path: string, onLine: (line: string) => false | void): void {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(64 * 1024);
  let leftover = "";
  try {
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buf, 0, buf.length, null)) > 0) {
      leftover += buf.subarray(0, bytesRead).toString("utf8");
      let newlineAt = leftover.indexOf("\n");
      while (newlineAt !== -1) {
        const line = leftover.slice(0, newlineAt);
        leftover = leftover.slice(newlineAt + 1);
        if (onLine(line) === false) return;
        newlineAt = leftover.indexOf("\n");
      }
    }
    if (leftover.length > 0) onLine(leftover);
  } finally {
    closeSync(fd);
  }
}

export function collectScopedJsonlLines(path: string, marker: string): string[] {
  const scoped: string[] = [];
  let capturing = false;
  forEachLineSync(path, (line) => {
    if (line.includes(marker)) {
      capturing = true;
      scoped.push(line);
      return;
    }
    if (capturing) {
      if (line.includes(MARKER_PREFIX)) return false;
      scoped.push(line);
    }
  });
  return scoped;
}

export function fileMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
