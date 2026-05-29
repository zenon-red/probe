import { SUBCOMMAND_PARENTS } from "./subcommand-registry.js";

interface HelpSectionItem {
  name: string;
  detail: string;
}

export interface HelpSpec {
  command: string;
  description: string;
  usage: string[];
  actions?: HelpSectionItem[];
  options?: HelpSectionItem[];
  examples?: string[];
  notes?: string[];
}

export const JSON_FLAG_ARG_DESCRIPTION =
  "Emit JSON instead of default TOON (compatibility with JSON-only tools)";

export const JSON_FLAG_HELP_DETAIL =
  "JSON output (default is TOON — preferred for agents, more token-efficient)";

const levenshtein = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
};

export const suggestCommand = (unknown: string, candidates: string[]): string | undefined => {
  let best: { command: string; distance: number } | undefined;

  for (const command of candidates) {
    const distance = levenshtein(unknown.toLowerCase(), command.toLowerCase());
    if (distance > 2) continue;
    if (!best || distance < best.distance) {
      best = { command, distance };
    }
  }

  return best?.command;
};

const directHelpCommands = new Set([
  "login",
  "sign",
  "nexus",
  "query",
  "doctor",
  "upgrade",
  "version",
]);

let forceHelpFlag = false;
let forceHelpJsonFlag = false;

export const setHelpJsonRequested = (enabled: boolean): void => {
  forceHelpJsonFlag = enabled;
};

export const helpJsonRequested = (): boolean => forceHelpJsonFlag;

export const mergeHelpSpec = (base: HelpSpec, override?: Partial<HelpSpec>): HelpSpec => {
  if (!override) return base;
  return {
    command: override.command ?? base.command,
    description: override.description ?? base.description,
    usage: override.usage ?? base.usage,
    actions: override.actions ?? base.actions,
    options: override.options ?? base.options,
    examples: override.examples ?? base.examples,
    notes: override.notes ?? base.notes,
  };
};

export interface HelpJsonSpec {
  command: string;
  description: string;
  usage: string[];
  options?: HelpSectionItem[];
  actions?: HelpSectionItem[];
  examples?: string[];
  notes?: string[];
  missing_required?: string[];
}

export const printHelpJson = (spec: HelpJsonSpec): void => {
  const payload: Record<string, unknown> = {
    command: spec.command,
    description: spec.description,
    usage: spec.usage,
  };
  if (spec.options && spec.options.length > 0) payload.options = spec.options;
  if (spec.actions && spec.actions.length > 0) payload.actions = spec.actions;
  if (spec.examples && spec.examples.length > 0) payload.examples = spec.examples;
  if (spec.notes && spec.notes.length > 0) payload.notes = spec.notes;
  if (spec.missing_required && spec.missing_required.length > 0) {
    payload.missing_required = spec.missing_required;
  }
  console.log(JSON.stringify(payload, null, 2));
};

const renderItems = (items: HelpSectionItem[]): string => {
  const width = Math.max(...items.map((i) => i.name.length), 0);
  return items.map((i) => `  ${i.name.padEnd(width)}  ${i.detail}`).join("\n");
};

export const printHelp = (spec: HelpSpec): void => {
  const notes = [...(spec.notes || [])];
  const hasHostModuleOption = (spec.options || []).some(
    (item) => item.name.includes("--host") && item.name.includes("--module"),
  );
  const hasHostModuleNote = notes.some(
    (note) => note.includes("--host") && note.includes("--module"),
  );
  if (hasHostModuleOption && !hasHostModuleNote) {
    notes.push(
      "--host sets the SpacetimeDB server endpoint; --module sets the target module/database name (default: nexus).",
    );
  }

  const lines: string[] = [];
  lines.push(`${spec.command} • ${spec.description}`);

  lines.push("");
  lines.push("USAGE");
  for (const entry of spec.usage) {
    lines.push(`  ${entry}`);
  }

  if (spec.actions && spec.actions.length > 0) {
    lines.push("");
    lines.push("ACTIONS");
    lines.push(renderItems(spec.actions));
  }

  if (spec.options && spec.options.length > 0) {
    lines.push("");
    lines.push("OPTIONS");
    lines.push(renderItems(spec.options));
  }

  if (spec.examples && spec.examples.length > 0) {
    lines.push("");
    lines.push("EXAMPLES");
    for (const example of spec.examples) {
      lines.push(`  ${example}`);
    }
  }

  if (notes.length > 0) {
    lines.push("");
    lines.push("NOTES");
    for (const note of notes) {
      lines.push(`  - ${note}`);
    }
  }

  console.log(lines.join("\n"));
};

export const printConciseRootHelp = (description: string): void => {
  const lines = [
    `probe • ${description}`,
    "",
    "USAGE",
    "  probe <command> [positionals] [options]",
    "  probe task list",
    "  probe action show <id>",
    "",
    "Run probe --help for the full command list.",
  ];
  console.log(lines.join("\n"));
};

export const setForceHelpRequested = (enabled: boolean): void => {
  forceHelpFlag = enabled;
};

export const forceHelpRequested = (): boolean => forceHelpFlag;

export const normalizeHelpArgv = (
  argv: string[],
): { argv: string[]; forceHelp: boolean; forceHelpJson: boolean } => {
  const hasHelp = argv.includes("--help") || argv.includes("-h");
  const hasHelpJson = hasHelp && argv.includes("--json");
  if (!hasHelp) {
    return { argv, forceHelp: false, forceHelpJson: false };
  }

  if (argv.every((arg) => arg.startsWith("-"))) {
    return { argv: [], forceHelp: true, forceHelpJson: hasHelpJson };
  }

  const command = argv.find((arg) => !arg.startsWith("-"));
  if (!command) {
    return { argv, forceHelp: true, forceHelpJson: hasHelpJson };
  }

  const parentSubs = SUBCOMMAND_PARENTS[command];
  if (parentSubs) {
    const positionals = argv.filter((arg) => !arg.startsWith("-"));
    if (positionals.length > 1 && parentSubs.has(positionals[1]!)) {
      return { argv: [command, positionals[1]!], forceHelp: true, forceHelpJson: hasHelpJson };
    }
    return { argv: [command], forceHelp: true, forceHelpJson: hasHelpJson };
  }

  if (!directHelpCommands.has(command)) {
    return { argv: [command], forceHelp: true, forceHelpJson: hasHelpJson };
  }

  return { argv: [command], forceHelp: true, forceHelpJson: hasHelpJson };
};
