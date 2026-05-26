import type { Identity } from "spacetimedb";
import { DbConnection, type ErrorContext } from "~/module_bindings/index.js";

export type {
  Agent,
  AgentAction,
  AgentRuntimeStatus,
  AppliedGenesis,
  Artifact,
  Channel,
  Config,
  DiscoveredTask,
  DispatchRouteConfig,
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

import { getConfig, resolveSpacetimeArgs } from "./config.js";
import { error } from "./output.js";
import { getCachedToken } from "./token-cache.js";
import { getWalletInfo } from "./wallet.js";

export interface CommandConnectionArgs {
  wallet?: string;
  host?: string;
  module?: string;
}

export interface CommandContextOptions {
  host?: string;
  module?: string;
  wallet?: string;
  token?: string;
  subscribe?: string[];
  /** Factory that receives the connected identity and returns subscription SQL queries. */
  subscribeFactory?: (identity: Identity) => string[];
  onDisconnect?: (...args: unknown[]) => void;
}

export interface AuthInfo {
  wallet: string;
  token: string;
  /** null until onConnect assigns the SpacetimeDB identity */
  identity: Identity | null;
}

/**
 * Host/module inventory: docs/internal/host-module-inventory.md
 * Wave 2 (task 2.7): migrate call sites to use this helper for forwarding.
 */
export function commandContextOptions(
  args: CommandConnectionArgs,
  extra?: Omit<CommandContextOptions, keyof CommandConnectionArgs>,
): CommandContextOptions {
  return {
    ...extra,
    ...(args.wallet !== undefined ? { wallet: args.wallet } : {}),
    ...(args.host !== undefined ? { host: args.host } : {}),
    ...(args.module !== undefined ? { module: args.module } : {}),
  };
}

const DEFAULT_SUBSCRIBE = ["SELECT * FROM agents", "SELECT * FROM config"];

export const AGENT_SUBSCRIBE = ["SELECT * FROM agents"];

function resolveSubscriptions(options: CommandContextOptions, identity: Identity): string[] {
  if (options.subscribeFactory) return options.subscribeFactory(identity);
  if (Array.isArray(options.subscribe)) return options.subscribe;
  return DEFAULT_SUBSCRIBE;
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

  get agents() {
    return Array.from(this.conn.db.agents.iter());
  }

  get agentActions() {
    return Array.from(this.conn.db.agent_actions.iter());
  }

  get tasks() {
    return Array.from(this.conn.db.tasks.iter());
  }

  get taskDependencies() {
    return Array.from(this.conn.db.task_dependencies.iter());
  }

  get projects() {
    return Array.from(this.conn.db.projects.iter());
  }

  get ideas() {
    return Array.from(this.conn.db.ideas.iter());
  }

  get votes() {
    return Array.from(this.conn.db.votes.iter());
  }

  get evaluationDimensions() {
    return Array.from(this.conn.db.evaluation_dimensions.iter());
  }

  get messages() {
    return Array.from(this.conn.db.messages.iter());
  }

  get channels() {
    return Array.from(this.conn.db.channels.iter());
  }

  get projectMessages() {
    return Array.from(this.conn.db.project_messages.iter());
  }

  get projectChannels() {
    return Array.from(this.conn.db.project_channels.iter());
  }

  get discoveredTasks() {
    return Array.from(this.conn.db.discovered_tasks.iter());
  }

  get appliedGenesis() {
    return Array.from(this.conn.db.applied_genesis.iter());
  }

  get dispatchRouteConfig() {
    return Array.from(this.conn.db.dispatch_route_config.iter());
  }

  get artifacts() {
    return Array.from(this.conn.db.artifact.iter());
  }

  get agentRuntimeStatus() {
    return Array.from(this.conn.db.agent_runtime_status.iter());
  }

  /** STDB config table rows (named to avoid clashing with probe `config` settings). */
  get stdbConfig() {
    return Array.from(this.conn.db.config.iter());
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.conn.disconnect();
    }
  }

  static async create(options: CommandContextOptions = {}): Promise<CommandContext> {
    const config = await getConfig();
    const { host, module } = resolveSpacetimeArgs(options, config);
    const moduleName = module;
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
          identity: null,
        };
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, config.requestTimeout);

      DbConnection.builder()
        .withUri(host)
        .withDatabaseName(moduleName)
        .withToken(token || undefined)
        .onConnect((conn: DbConnection, identity: Identity, authToken: string) => {
          clearTimeout(timeout);

          if (auth) {
            auth.identity = identity;
          }

          const subscriptions = resolveSubscriptions(options, identity);

          conn
            .subscriptionBuilder()
            .onApplied(() => {
              resolve(new CommandContext(conn, config, identity, authToken, auth));
            })
            .onError((ctx: ErrorContext) => {
              reject(new Error(`Subscription error: ${ctx.event?.message || "Unknown error"}`));
            })
            .subscribe(subscriptions);
        })
        .onDisconnect((...disconnectArgs: unknown[]) => {
          options.onDisconnect?.(...disconnectArgs);
        })
        .onConnectError((_ctx: ErrorContext, err: Error) => {
          clearTimeout(timeout);
          const message = err.message.toLowerCase();
          if (message.includes("unauthorized") || message.includes("401")) {
            reject(new Error("Authentication required. Run `probe login <wallet> --save` first."));
          } else {
            reject(new Error(`Connection failed: ${err.message}`));
          }
        })
        .build();
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
    error("AUTH_REQUIRED", "No cached token. Run `probe login <wallet> --save` first.");
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

export async function callReducer<T>(
  ctx: CommandContext,
  reducer: (params: T) => Promise<void>,
  params: T,
): Promise<void> {
  const timeoutMs = Math.max(1000, ctx.config.requestTimeout);
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    reducer(params).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Reducer call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);
}

export async function callProcedure<TParams, R>(
  ctx: CommandContext,
  procedure: (params: TParams) => Promise<R>,
  params: TParams,
): Promise<R> {
  const timeoutMs = Math.max(1000, ctx.config.requestTimeout);
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    procedure(params).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Procedure call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);
}
