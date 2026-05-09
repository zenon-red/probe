import type { Identity } from "spacetimedb";
import { DbConnection, type ErrorContext, type tables } from "~/module_bindings/index.js";

export type {
  Agent,
  Channel,
  Config,
  DiscoveredTask,
  EvaluationDimension,
  Idea,
  IdentityRole,
  Message,
  Project,
  ProjectChannel,
  ProjectMessage,
  Task,
  TaskDependency,
  Vote,
} from "~/module_bindings/types.js";

import { getConfig } from "./config.js";
import { error } from "./output.js";
import { getCachedToken } from "./token-cache.js";
import { getWalletInfo } from "./wallet.js";

type TableName = Extract<keyof typeof tables, string>;

export interface CommandContextOptions {
  host?: string;
  module?: string;
  wallet?: string;
  token?: string;
  subscribe?: boolean;
  onDisconnect?: (...args: unknown[]) => void;
}

export interface AuthInfo {
  wallet: string;
  token: string;
  identity: Identity;
}

export class CommandContext implements AsyncDisposable {
  readonly conn: DbConnection;
  readonly identity?: Identity;
  readonly token?: string;
  readonly auth?: AuthInfo;
  readonly config: Awaited<ReturnType<typeof getConfig>>;

  private disposed = false;

  private constructor(
    conn: DbConnection,
    config: Awaited<ReturnType<typeof getConfig>>,
    identity?: Identity,
    token?: string,
    auth?: AuthInfo,
  ) {
    this.conn = conn;
    this.config = config;
    this.identity = identity;
    this.token = token;
    this.auth = auth;
  }

  get db() {
    return this.conn.db;
  }

  iter<T>(tableName: TableName): T[] {
    const db = this.db as Record<string, { iter?: () => IterableIterator<T> }>;
    const table = db[tableName];
    if (table?.iter) {
      return Array.from(table.iter());
    }
    return [];
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.conn.disconnect();
    }
  }

  static async create(options: CommandContextOptions = {}): Promise<CommandContext> {
    const config = await getConfig();
    const host = options.host || config.spacetime.host;
    const moduleName = options.module || config.spacetime.module;
    const walletName = options.wallet || config.defaultWallet;

    let token = options.token;
    let auth: AuthInfo | undefined;

    if (!token && walletName) {
      const cached = await getCachedToken(walletName);
      if (cached) {
        token = cached.token;
        auth = {
          wallet: walletName,
          token: cached.token,
          identity: undefined as unknown as Identity,
        };
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, config.requestTimeout);

      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const suppressSdkConnectLog = (...logArgs: unknown[]): void => {
        const shouldSuppress = logArgs.some(
          (arg) => typeof arg === "string" && arg.includes("Connecting to SpacetimeDB WS..."),
        );
        if (!shouldSuppress) {
          originalConsoleLog(...(logArgs as Parameters<typeof console.log>));
        }
      };
      // Suppress SDK error spam during connection - errors are properly thrown and handled by callers
      const suppressSdkError = (..._logArgs: unknown[]): void => {
        // Errors are handled by onConnectError and rejected properly
        if (process.env.PROBE_DEBUG) {
          originalConsoleError("[probe:debug]", ..._logArgs);
        }
      };

      console.log = suppressSdkConnectLog as typeof console.log;
      console.error = suppressSdkError as typeof console.error;

      try {
        DbConnection.builder()
          .withUri(host)
          .withDatabaseName(moduleName)
          .withToken(token || undefined)
          .onConnect((conn: DbConnection, identity: Identity, authToken: string) => {
            clearTimeout(timeout);

            if (auth) {
              auth.identity = identity;
            }

            const shouldSubscribe = options.subscribe !== false;

            if (shouldSubscribe) {
              conn
                .subscriptionBuilder()
                .onApplied(() => {
                  resolve(new CommandContext(conn, config, identity, authToken, auth));
                })
                .onError((ctx: ErrorContext) => {
                  reject(new Error(`Subscription error: ${ctx.event?.message || "Unknown error"}`));
                })
                .subscribe([
                  "SELECT * FROM agents",
                  "SELECT * FROM tasks",
                  "SELECT * FROM ideas",
                  "SELECT * FROM messages",
                  "SELECT * FROM channels",
                  "SELECT * FROM projects",
                  "SELECT * FROM votes",
                  "SELECT * FROM evaluation_dimensions",
                  "SELECT * FROM discovered_tasks",
                  "SELECT * FROM task_dependencies",
                  "SELECT * FROM identity_roles",
                  "SELECT * FROM config",
                  "SELECT * FROM project_channels",
                  "SELECT * FROM project_messages",
                ]);
            } else {
              resolve(new CommandContext(conn, config, identity, authToken, auth));
            }
          })
          .onDisconnect((...disconnectArgs: unknown[]) => {
            options.onDisconnect?.(...disconnectArgs);
          })
          .onConnectError((_ctx: ErrorContext, err: Error) => {
            clearTimeout(timeout);
            const message = err.message.toLowerCase();
            if (message.includes("unauthorized") || message.includes("401")) {
              reject(new Error("Authentication required. Run `probe auth <wallet> --save` first."));
            } else {
              reject(new Error(`Connection failed: ${err.message}`));
            }
          })

          .build();
      } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
      }
    });
  }
}

export async function requireAuth(options: CommandContextOptions): Promise<CommandContext> {
  const config = await getConfig();
  const walletName = options.wallet || config.defaultWallet;

  if (!walletName) {
    error("WALLET_REQUIRED", "Wallet required. Use --wallet or set default wallet.");
  }

  const wallet = await getWalletInfo(walletName);
  if (!wallet) {
    error("WALLET_NOT_FOUND", `Wallet not found: ${walletName}`);
  }

  const cached = await getCachedToken(walletName);
  if (!cached) {
    error("AUTH_REQUIRED", "No cached token. Run `probe auth <wallet> --save` first.");
  }

  return CommandContext.create({
    ...options,
    wallet: walletName,
    token: cached.token,
  });
}

export async function withContext<T>(
  options: CommandContextOptions,
  handler: (ctx: CommandContext) => Promise<T>,
): Promise<T> {
  await using ctx = await CommandContext.create(options);
  return await handler(ctx);
}

export async function withAuth<T>(
  options: CommandContextOptions,
  handler: (ctx: CommandContext) => Promise<T>,
): Promise<T> {
  await using ctx = await requireAuth(options);
  return await handler(ctx);
}

export async function callReducer(
  ctx: CommandContext,
  reducerName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const reducers = ctx.conn.reducers as unknown as Record<
    string,
    (args: Record<string, unknown>) => Promise<void>
  >;
  const reducer = reducers[reducerName];
  if (typeof reducer !== "function") {
    throw new Error(`Reducer not found: ${reducerName}`);
  }

  const timeoutMs = Math.max(1000, ctx.config.requestTimeout);
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    reducer(args).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Reducer timed out after ${timeoutMs}ms: ${reducerName}`)),
        timeoutMs,
      );
    }),
  ]);
}

export async function callProcedure<T = unknown>(
  ctx: CommandContext,
  procedureName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const procedures = ctx.conn.procedures as unknown as Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >;
  const accessorName = procedureName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const proc = procedures[accessorName];
  if (typeof proc !== "function") {
    throw new Error(`Procedure not found: ${procedureName}`);
  }
  return (await proc(args)) as T;
}
