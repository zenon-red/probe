import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function isPathWritable(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const testFile = join(dir, ".write_test");
    await writeFile(testFile, "", { mode: 0o600 });
    await access(testFile);
    await unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

export async function ensurePathWritable(dir: string): Promise<boolean> {
  return isPathWritable(dir);
}
