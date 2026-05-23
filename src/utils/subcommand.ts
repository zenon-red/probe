import type { CommandDef, Resolvable } from "citty";
import { defineCommand } from "citty";
import { forceHelpRequested, printHelp, type HelpSpec } from "./help.js";
import { error } from "./output.js";
import { SUBCOMMAND_PARENTS } from "./subcommand-registry.js";

export { SUBCOMMAND_PARENTS } from "./subcommand-registry.js";

export type SubcommandParentSpec = {
  name: string;
  description: string;
  help: HelpSpec;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands: Record<string, Resolvable<CommandDef<any>>>;
  args?: CommandDef["args"];
};

export function defineSubcommandParent(spec: SubcommandParentSpec) {
  const subcommandNames = new Set(Object.keys(spec.subCommands));

  return defineCommand({
    meta: { name: spec.name, description: spec.description },
    args: spec.args,
    subCommands: spec.subCommands,
    run(ctx) {
      const fromArgs = (ctx.args._ as string[] | undefined) ?? [];
      const fromArgv = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
      const positionals = fromArgs.length > 0 ? fromArgs : fromArgv;
      const subcommand = positionals[0] === spec.name ? positionals[1] : undefined;

      if (subcommand && subcommandNames.has(subcommand)) {
        return;
      }

      if (forceHelpRequested()) {
        printHelp(spec.help);
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

export function guardUnknownSubcommand(argv: string[]): void {
  const positionals = argv.filter((arg) => !arg.startsWith("-"));
  if (positionals.length < 2) {
    return;
  }

  const parent = positionals[0]!;
  const sub = positionals[1]!;
  const known = SUBCOMMAND_PARENTS[parent];
  if (!known || known.has(sub)) {
    return;
  }

  error(
    "UNKNOWN_SUBCOMMAND",
    `Unknown ${parent} subcommand: ${sub}`,
    `Run: probe ${parent} --help`,
  );
}
