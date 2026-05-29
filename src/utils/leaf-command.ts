import type { ArgDef, CommandDef, Resolvable } from "citty";
import {
  forceHelpRequested,
  helpJsonRequested,
  mergeHelpSpec,
  printHelp,
  printHelpJson,
  type HelpSpec,
} from "./help.js";
import { LEAF_HELP_OVERRIDES } from "./leaf-help-overrides.js";

const LEAF_WRAPPED = Symbol("probe.leafWrapped");

type LeafArgDef = ArgDef & { name?: string };

function isPlainObject<T>(value: unknown): value is T {
  return typeof value === "object" && value !== null && !("then" in value);
}

function resolveArgsDef(args: CommandDef["args"]): Record<string, LeafArgDef> {
  if (!args) return {};
  if (typeof args === "function") return {};
  if (!isPlainObject<Record<string, LeafArgDef>>(args)) return {};
  return args;
}

function listRequiredArgNames(args: Record<string, LeafArgDef>): string[] {
  const names: string[] = [];
  for (const [key, arg] of Object.entries(args)) {
    if (arg.type === "positional") {
      if (arg.required !== false && arg.default === undefined) {
        names.push(arg.name ?? key);
      }
    } else if (arg.required === true && arg.default === undefined) {
      names.push(arg.name ?? key);
    }
  }
  return names;
}

function relaxArgs(args: Record<string, LeafArgDef>): Record<string, LeafArgDef> {
  const relaxed: Record<string, LeafArgDef> = {};
  for (const [key, arg] of Object.entries(args)) {
    if (arg.type === "positional") {
      if (arg.required !== false && arg.default === undefined) {
        relaxed[key] = { ...arg, required: false };
      } else {
        relaxed[key] = arg;
      }
    } else if (arg.required === true) {
      relaxed[key] = { ...arg, required: false };
    } else {
      relaxed[key] = arg;
    }
  }
  return relaxed;
}

function argValue(args: Record<string, unknown>, key: string, arg: LeafArgDef): unknown {
  if (key in args) return args[key];
  const name = arg.name ?? key;
  if (name in args) return args[name];
  return undefined;
}

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function listMissingRequired(
  parsed: Record<string, unknown>,
  args: Record<string, LeafArgDef>,
): string[] {
  const missing: string[] = [];
  for (const [key, arg] of Object.entries(args)) {
    const isRequired =
      arg.type === "positional"
        ? arg.required !== false && arg.default === undefined
        : arg.required === true && arg.default === undefined;
    if (!isRequired) continue;

    const value = argValue(parsed, key, arg);
    if (isMissingValue(value)) {
      if (arg.type === "positional") {
        missing.push(`<${(arg.name ?? key).toUpperCase()}>`);
      } else {
        missing.push(`--${arg.name ?? key}`);
      }
    }
  }
  return missing;
}

function formatFlagName(key: string, arg: LeafArgDef): string {
  if (arg.type === "positional") {
    return `<${(arg.name ?? key).toUpperCase()}>`;
  }
  return `--${arg.name ?? key}`;
}

export function buildHelpFromArgs(
  commandPath: string,
  description: string,
  args: Record<string, LeafArgDef>,
): HelpSpec {
  const positionals: string[] = [];
  const options: NonNullable<HelpSpec["options"]> = [];

  for (const [key, arg] of Object.entries(args)) {
    if (key === "json") continue;
    const flag = formatFlagName(key, arg);
    const isRequired =
      arg.type === "positional"
        ? arg.required !== false && arg.default === undefined
        : arg.required === true && arg.default === undefined;
    const detail = [arg.description, isRequired ? "(required)" : undefined]
      .filter(Boolean)
      .join(" ");

    if (arg.type === "positional") {
      positionals.push(isRequired ? flag : `[${(arg.name ?? key).toUpperCase()}]`);
    }
    options.push({ name: flag, detail });
  }

  const usageParts = [commandPath, ...positionals, "[options]"].filter(Boolean);
  return {
    command: commandPath,
    description,
    usage: [usageParts.join(" ")],
    options,
  };
}

function resolveCommandMeta(cmd: CommandDef): { name?: string; description?: string } {
  const meta = cmd.meta;
  if (!meta) return {};
  if (typeof meta === "function") return {};
  if (!isPlainObject<{ name?: string; description?: string }>(meta)) return {};
  return meta;
}

function emitLeafHelp(spec: HelpSpec, missing?: string[]): void {
  if (helpJsonRequested()) {
    printHelpJson({ ...spec, missing_required: missing });
    return;
  }
  if (missing && missing.length > 0) {
    printHelp({
      ...spec,
      notes: [
        ...(spec.notes ?? []),
        `Missing required: ${missing.join(", ")}`,
        `Run: ${spec.command} --help`,
      ],
    });
    return;
  }
  printHelp(spec);
}

export function wrapLeafCommand(
  cmd: CommandDef,
  commandPath: string,
  helpOverride?: Partial<HelpSpec>,
): CommandDef {
  if ((cmd as Record<symbol, boolean>)[LEAF_WRAPPED]) {
    return cmd;
  }

  const originalArgs = resolveArgsDef(cmd.args);
  if (listRequiredArgNames(originalArgs).length === 0) {
    return cmd;
  }

  const meta = resolveCommandMeta(cmd);
  const generated = buildHelpFromArgs(commandPath, meta.description ?? commandPath, originalArgs);
  const helpSpec = mergeHelpSpec(generated, helpOverride ?? LEAF_HELP_OVERRIDES[commandPath]);
  const relaxedArgs = relaxArgs(originalArgs);
  const originalRun = cmd.run;

  const wrapped: CommandDef = {
    ...cmd,
    args: relaxedArgs,
    async run(ctx) {
      if (forceHelpRequested()) {
        emitLeafHelp(helpSpec);
        return;
      }

      const missing = listMissingRequired(ctx.args as Record<string, unknown>, originalArgs);
      if (missing.length > 0) {
        emitLeafHelp(helpSpec, missing);
        return;
      }

      return originalRun?.(ctx);
    },
  };

  (wrapped as Record<symbol, boolean>)[LEAF_WRAPPED] = true;
  return wrapped;
}

export function wrapSubCommands<T extends Record<string, Resolvable<CommandDef>>>(
  subCommands: T,
  parentCommandPath: string,
): T {
  const wrapped = {} as T;
  for (const [name, cmd] of Object.entries(subCommands)) {
    const resolved = typeof cmd === "function" ? (cmd as () => CommandDef)() : (cmd as CommandDef);
    const commandPath = `${parentCommandPath} ${name}`;
    (wrapped as Record<string, Resolvable<CommandDef>>)[name] = wrapLeafCommand(
      resolved,
      commandPath,
    );
  }
  return wrapped;
}
