import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type StoredAcpSession = {
  sessionId: string;
  agentSessionId?: string;
  harness: string;
  agentId: string;
  updatedAt: string;
};

const STORE_DIR = join(homedir(), ".probe", "acp-sessions");

function storePath(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(STORE_DIR, `${safe}.json`);
}

export async function loadStoredSession(agentId: string): Promise<StoredAcpSession | undefined> {
  try {
    const raw = await readFile(storePath(agentId), "utf8");
    return JSON.parse(raw) as StoredAcpSession;
  } catch {
    return undefined;
  }
}

export async function saveStoredSession(record: StoredAcpSession): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(storePath(record.agentId), JSON.stringify(record, null, 2), {
    mode: 0o600,
  });
}

export async function clearStoredSession(agentId: string): Promise<void> {
  try {
    await unlink(storePath(agentId));
  } catch {
    // ignore
  }
}
