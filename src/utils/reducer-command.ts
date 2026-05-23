import {
  type CommandConnectionArgs,
  type CommandContext,
  type CommandContextOptions,
  callReducer,
  commandContextOptions,
  withAuth,
} from "./context.js";
import { errorMessage, isProbeError } from "./errors.js";
import { error } from "./output.js";

export interface RunReducerCommandOptions<TParams> {
  subscribe?: string[];
  subscribeFactory?: CommandContextOptions["subscribeFactory"];
  onDisconnect?: CommandContextOptions["onDisconnect"];
  reducer: (ctx: CommandContext) => (params: TParams) => Promise<void>;
  params: TParams | ParamsFactory<TParams>;
}

type ParamsFactory<TParams> = (ctx: CommandContext) => TParams | Promise<TParams>;

function isParamsFactory<TParams>(
  params: TParams | ParamsFactory<TParams>,
): params is ParamsFactory<TParams> {
  return typeof params === "function";
}

export async function runReducerCommand<TParams>(
  args: CommandConnectionArgs,
  options: RunReducerCommandOptions<TParams>,
): Promise<void> {
  try {
    await withAuth(
      commandContextOptions(args, {
        subscribe: options.subscribe,
        subscribeFactory: options.subscribeFactory,
        onDisconnect: options.onDisconnect,
      }),
      async (ctx) => {
        const params = isParamsFactory(options.params) ? await options.params(ctx) : options.params;
        await callReducer(ctx, options.reducer(ctx), params);
      },
    );
  } catch (err) {
    if (isProbeError(err)) throw err;
    error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
  }
}

export async function runAuthenticatedCommand(
  args: CommandConnectionArgs,
  options: Omit<CommandContextOptions, keyof CommandConnectionArgs>,
  run: (ctx: CommandContext) => Promise<void>,
): Promise<void> {
  try {
    await withAuth(commandContextOptions(args, options), run);
  } catch (err) {
    if (isProbeError(err)) throw err;
    error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
  }
}
