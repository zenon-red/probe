import { createHash } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { jsonReplacer, type DaemonEvent } from "./events.js";

const IPC_SCHEMA = "probe.nexus.ipc.v1";
const IPC_HISTORY_LIMIT = 500;

export class DaemonAlreadyRunningError extends Error {
  readonly wallet: string;
  readonly endpoint: string;

  constructor(wallet: string, endpoint: string) {
    super(`Nexus daemon already running for wallet ${wallet}`);
    this.wallet = wallet;
    this.endpoint = endpoint;
  }
}

export type DaemonIpcLock = {
  endpoint: string;
  publish?: (event: DaemonEvent) => void;
  release: () => Promise<void>;
};

export type DaemonIpcStream = {
  endpoint: string;
  close: () => void;
};

function endpointNameForWallet(wallet: string): string {
  const hash = createHash("sha256").update(wallet).digest("hex").slice(0, 12);
  const safe = wallet.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48) || "default";
  return `${safe}-${hash}`;
}

export function daemonIpcEndpointForWallet(wallet: string): string {
  const name = endpointNameForWallet(wallet);
  if (platform() === "win32") {
    return `\\\\.\\pipe\\probe-nexus-${name}`;
  }

  const root = process.env.PROBE_NEXUS_IPC_ROOT?.trim() || defaultUnixIpcRoot();
  return join(root, `${name}.sock`);
}

function defaultUnixIpcRoot(): string {
  const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  if (xdgRuntimeDir) return join(xdgRuntimeDir, "probe-nexus");

  const userKey =
    typeof process.getuid === "function" ? String(process.getuid()) : homedirHash().slice(0, 12);
  return join(tmpdir(), `probe-nexus-${userKey}`);
}

function homedirHash(): string {
  return createHash("sha256").update(homedir()).digest("hex");
}

function isAddressInUse(err: unknown): boolean {
  return errorCode(err) === "EADDRINUSE";
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof Error) || !("code" in err)) return undefined;
  return (err as Error & { code?: string }).code;
}

function isUnixSocketEndpoint(endpoint: string): boolean {
  return platform() !== "win32" && endpoint.endsWith(".sock");
}

async function connectSucceeds(endpoint: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await tryConnect(endpoint)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function tryConnect(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(100);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

async function listen(server: net.Server, endpoint: string): Promise<void> {
  if (isUnixSocketEndpoint(endpoint)) {
    await mkdir(dirname(endpoint), { recursive: true, mode: 0o700 });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function prepareUnixEndpoint(wallet: string, endpoint: string): Promise<void> {
  if (!isUnixSocketEndpoint(endpoint)) return;

  await mkdir(dirname(endpoint), { recursive: true, mode: 0o700 });
  try {
    await lstat(endpoint);
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      return;
    }
    throw err;
  }

  if (await connectSucceeds(endpoint)) {
    throw new DaemonAlreadyRunningError(wallet, endpoint);
  }
  await rm(endpoint, { force: true });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function writeIpcLine(socket: net.Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value, jsonReplacer)}\n`);
}

function createIpcServer(
  wallet: string,
  clients: Set<net.Socket>,
  history: DaemonEvent[],
): net.Server {
  return net.createServer((socket) => {
    writeIpcLine(socket, {
      schema: IPC_SCHEMA,
      kind: "hello",
      wallet,
      pid: process.pid,
    });
    for (const event of history) {
      writeIpcLine(socket, { schema: IPC_SCHEMA, kind: "event", event });
    }
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    socket.once("error", () => clients.delete(socket));
  });
}

export async function acquireDaemonIpcLock(wallet: string): Promise<DaemonIpcLock> {
  const endpoint = daemonIpcEndpointForWallet(wallet);
  const clients = new Set<net.Socket>();
  const history: DaemonEvent[] = [];
  const server = createIpcServer(wallet, clients, history);
  await prepareUnixEndpoint(wallet, endpoint);

  try {
    await listen(server, endpoint);
  } catch (err) {
    if (!isAddressInUse(err)) throw err;

    if (await connectSucceeds(endpoint)) {
      throw new DaemonAlreadyRunningError(wallet, endpoint);
    }

    if (!isUnixSocketEndpoint(endpoint)) throw err;
    await rm(endpoint, { force: true });
    await listen(server, endpoint);
  }

  return {
    endpoint,
    publish: (event) => {
      history.push(event);
      if (history.length > IPC_HISTORY_LIMIT) history.shift();
      const line = `${JSON.stringify({ schema: IPC_SCHEMA, kind: "event", event }, jsonReplacer)}\n`;
      for (const client of clients) {
        client.write(line);
      }
    },
    release: async () => {
      for (const client of clients) {
        client.destroy();
      }
      await closeServer(server);
      if (isUnixSocketEndpoint(endpoint)) {
        await rm(endpoint, { force: true });
      }
    },
  };
}

export async function connectDaemonEventStream(
  wallet: string,
  onEvent: (event: DaemonEvent) => void,
): Promise<DaemonIpcStream> {
  const endpoint = daemonIpcEndpointForWallet(wallet);
  const socket = net.createConnection(endpoint);
  socket.setEncoding("utf8");
  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as { schema?: string; kind?: string; event?: DaemonEvent };
        if (message.schema === IPC_SCHEMA && message.kind === "event" && message.event) {
          onEvent(message.event);
        }
      } catch {
        // Ignore malformed IPC lines from older or interrupted daemons.
      }
    }
  });

  return {
    endpoint,
    close: () => socket.destroy(),
  };
}
