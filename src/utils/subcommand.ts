import type { CommandDef, Resolvable } from "citty";
import { defineCommand } from "citty";
import {
  forceHelpRequested,
  helpJsonRequested,
  printHelp,
  printHelpJson,
  type HelpSpec,
} from "./help.js";
import { wrapSubCommands } from "./leaf-command.js";
import { error } from "./output.js";
import {
  SUBCOMMAND_PARENT_BOOLEAN_FLAGS,
  SUBCOMMAND_PARENT_VALUE_FLAGS,
  SUBCOMMAND_PARENTS,
} from "./subcommand-registry.js";

export type SubcommandParentSpec = {
  name: string;
  description: string;
  help: HelpSpec;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands: Record<string, Resolvable<CommandDef<any>>>;
  args?: CommandDef["args"];
};

type ParsedFlag = { name: string; inlineValue: boolean };

function parseFlagToken(arg: string): ParsedFlag | null {
  if (!arg.startsWith("-")) return null;
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      return { name: arg.slice(2, eq), inlineValue: true };
    }
    return { name: arg.slice(2), inlineValue: false };
  }
  return { name: arg.slice(1), inlineValue: false };
}

function flagConsumesNextArgv(flag: ParsedFlag): boolean {
  if (flag.inlineValue) return false;
  if (SUBCOMMAND_PARENT_BOOLEAN_FLAGS.has(flag.name)) return false;
  if (SUBCOMMAND_PARENT_VALUE_FLAGS.has(flag.name)) return true;
  return flag.name.length > 1;
}

export function scanArgvCommandTokens(argv: string[]): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flag = parseFlagToken(arg);
    if (!flag) {
      tokens.push(arg);
      continue;
    }
    if (flagConsumesNextArgv(flag)) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        i += 1;
      }
    }
  }
  return tokens;
}

export function resolveKnownSubcommand(
  parentName: string,
  subcommandNames: ReadonlySet<string>,
  tokens: string[],
): string | undefined {
  const start = tokens[0] === parentName ? 1 : 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (subcommandNames.has(token)) return token;
  }
  return undefined;
}

function firstUnknownSubcommandAfterParent(
  parentName: string,
  subcommandNames: ReadonlySet<string>,
  tokens: string[],
): string | undefined {
  const start = tokens[0] === parentName ? 1 : 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!subcommandNames.has(token)) return token;
  }
  return undefined;
}

export function defineSubcommandParent(spec: SubcommandParentSpec) {
  const subcommandNames = new Set(Object.keys(spec.subCommands));

  const parentPath = spec.help.command;

  return defineCommand({
    meta: { name: spec.name, description: spec.description },
    args: spec.args,
    subCommands: wrapSubCommands(spec.subCommands, parentPath),
    run(ctx) {
      const cittyPositionals = (ctx.args._ as string[] | undefined) ?? [];
      const subcommand = resolveKnownSubcommand(spec.name, subcommandNames, cittyPositionals);

      if (subcommand) {
        return;
      }

      if (forceHelpRequested()) {
        if (helpJsonRequested()) {
          printHelpJson(spec.help);
        } else {
          printHelp(spec.help);
        }
        return;
      }

      const names = [...subcommandNames].sort().join("|");
      error(
        "SUBCOMMAND_REQUIRED",
        `Usage: probe ${spec.name} <${names}> [args]`,
        `Run: probe ${spec.name} --help`,
      );
    },
  });
}

const NEXUS_CONFUSED_SIBLINGS = new Set([
  "agent",
  "task",
  "message",
  "idea",
  "discover",
  "project",
  "action",
  "genesis",
  "artifact",
  "review",
  "query",
  "onboard",
  "cooldown",
]);

export function guardNexusDaemonArgv(argv: string[]): void {
  const tokens = scanArgvCommandTokens(argv);
  const nexusIdx = tokens.indexOf("nexus");
  if (nexusIdx === -1) return;

  const trailing = tokens.slice(nexusIdx + 1);
  if (trailing.length === 0) return;

  const suggested = `probe ${trailing.join(" ")}`;
  const looksLikeSibling = trailing[0] !== undefined && NEXUS_CONFUSED_SIBLINGS.has(trailing[0]);

  error(
    "UNKNOWN_ARGS",
    `probe nexus is the persistent daemon only; unexpected arguments: ${trailing.join(" ")}`,
    looksLikeSibling ? `Did you mean: ${suggested}?` : "Run: probe nexus --help",
  );
}

export function guardUnknownSubcommand(argv: string[]): void {
  const tokens = scanArgvCommandTokens(argv);
  if (tokens.length < 2) {
    return;
  }

  const parent = tokens[0]!;
  const known = SUBCOMMAND_PARENTS[parent];
  if (!known) {
    return;
  }

  if (resolveKnownSubcommand(parent, known, tokens)) {
    return;
  }

  const unknown = firstUnknownSubcommandAfterParent(parent, known, tokens);
  if (!unknown) {
    return;
  }

  error(
    "UNKNOWN_SUBCOMMAND",
    `Unknown ${parent} subcommand: ${unknown}`,
    `Run: probe ${parent} --help`,
  );
}
