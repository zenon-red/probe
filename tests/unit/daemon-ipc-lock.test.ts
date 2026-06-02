import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  acquireDaemonIpcLock,
  daemonIpcEndpointForWallet,
  DaemonAlreadyRunningError,
  type DaemonIpcLock,
} from "../../src/daemon/ipc-lock.js";

const originalIpcRoot = process.env.PROBE_NEXUS_IPC_ROOT;
const roots: string[] = [];
const locks: DaemonIpcLock[] = [];

async function useTempIpcRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "probe-ipc-lock-"));
  roots.push(root);
  process.env.PROBE_NEXUS_IPC_ROOT = root;
  return root;
}

afterEach(async () => {
  while (locks.length > 0) {
    await locks.pop()?.release();
  }

  if (originalIpcRoot === undefined) {
    delete process.env.PROBE_NEXUS_IPC_ROOT;
  } else {
    process.env.PROBE_NEXUS_IPC_ROOT = originalIpcRoot;
  }
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

describe("daemon IPC lock", () => {
  it("rejects a second daemon for the same wallet", async () => {
    await useTempIpcRoot();
    locks.push(await acquireDaemonIpcLock("wallet-a"));

    await expect(acquireDaemonIpcLock("wallet-a")).rejects.toBeInstanceOf(
      DaemonAlreadyRunningError,
    );
  });

  it("allows independent wallets to run concurrently", async () => {
    await useTempIpcRoot();

    locks.push(await acquireDaemonIpcLock("wallet-a"));
    locks.push(await acquireDaemonIpcLock("wallet-b"));

    expect(locks[0]?.endpoint).not.toBe(locks[1]?.endpoint);
  });

  it("removes stale Unix socket files before acquiring", async () => {
    if (process.platform === "win32") return;

    await useTempIpcRoot();
    const endpoint = daemonIpcEndpointForWallet("stale-wallet");
    await mkdir(dirname(endpoint), { recursive: true });
    await writeFile(endpoint, "");

    locks.push(await acquireDaemonIpcLock("stale-wallet"));

    expect(locks[0]?.endpoint).toBe(endpoint);
  });
});
