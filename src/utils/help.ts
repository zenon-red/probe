import { blue, bold, cyan, dim, gray, green, white } from "kolorist";

interface HelpSectionItem {
	name: string;
	detail: string;
}

interface HelpSpec {
	command: string;
	description: string;
	usage: string[];
	actions?: HelpSectionItem[];
	options?: HelpSectionItem[];
	examples?: string[];
	notes?: string[];
}

const actionHelpCommands = new Set([
	"agent",
	"task",
	"message",
	"idea",
	"discover",
	"project",
	"config",
]);
const directHelpCommands = new Set([
	"wallet",
	"auth",
	"sign",
	"token",
	"nexus",
	"query",
	"doctor",
]);
const walletSubcommands = new Set([
	"create",
	"import",
	"list",
	"show",
	"delete",
	"default",
]);

let forceHelpFlag = false;

const neonBadge = (text: string): string =>
	`\u001b[48;2;120;239;93m\u001b[38;2;12;28;16m ${text} \u001b[0m`;
const section = (label: string): string => neonBadge(label.toUpperCase());

const renderItems = (
	items: HelpSectionItem[],
	nameColor: (value: string) => string,
): string => {
	const width = Math.max(...items.map((i) => i.name.length), 0);
	return items
		.map((i) => `  ${nameColor(i.name.padEnd(width))}  ${i.detail}`)
		.join("\n");
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
	lines.push(
		`${bold(white(spec.command))} ${dim("•")} ${gray(spec.description)}`,
	);

	lines.push("");
	lines.push(section("Usage"));
	for (const entry of spec.usage) {
		lines.push(`  ${white(entry)}`);
	}

	if (spec.actions && spec.actions.length > 0) {
		lines.push("");
		lines.push(section("Actions"));
		lines.push(renderItems(spec.actions, green));
	}

	if (spec.options && spec.options.length > 0) {
		lines.push("");
		lines.push(section("Options"));
		lines.push(renderItems(spec.options, blue));
	}

	if (spec.examples && spec.examples.length > 0) {
		lines.push("");
		lines.push(section("Examples"));
		for (const example of spec.examples) {
			lines.push(`  ${cyan(example)}`);
		}
	}

	if (notes.length > 0) {
		lines.push("");
		lines.push(section("Notes"));
		for (const note of notes) {
			lines.push(`  ${dim("-")} ${note}`);
		}
	}

	console.log(lines.join("\n"));
};

export const setForceHelpRequested = (enabled: boolean): void => {
	forceHelpFlag = enabled;
};

export const forceHelpRequested = (): boolean => forceHelpFlag;

export const normalizeHelpArgv = (
	argv: string[],
): { argv: string[]; forceHelp: boolean } => {
	const hasHelp = argv.includes("--help") || argv.includes("-h");
	if (!hasHelp) {
		return { argv, forceHelp: false };
	}

	if (argv.every((arg) => arg.startsWith("-"))) {
		return { argv: [], forceHelp: true };
	}

	const command = argv.find((arg) => !arg.startsWith("-"));
	if (!command) {
		return { argv, forceHelp: true };
	}

	if (actionHelpCommands.has(command)) {
		return { argv: [command], forceHelp: true };
	}

	if (!directHelpCommands.has(command)) {
		return { argv, forceHelp: true };
	}

	if (command === "wallet") {
		const positionals = argv.filter((arg) => !arg.startsWith("-"));
		if (positionals.length > 1 && walletSubcommands.has(positionals[1])) {
			return { argv: [command, positionals[1]], forceHelp: true };
		}
	}

	return { argv: [command], forceHelp: true };
};
