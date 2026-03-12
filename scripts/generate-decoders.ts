#!/usr/bin/env tsx
/**
 * Generates algebraic type decoders from SpacetimeDB TypeScript bindings.
 *
 * This script parses the generated types.ts and *_table.ts files to extract:
 * - Enum definitions (variant names and order)
 * - Table column types (which columns use enums, options, timestamps)
 *
 * It generates src/generated/decoders.ts with decoder functions for each table.
 *
 * Run this script after regenerating SpacetimeDB bindings:
 *   npm run generate:decoders
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Type definitions for parsing
interface EnumDef {
	name: string;
	variants: string[];
}

interface ColumnType {
	name: string;
	sqlName: string; // snake_case version
	kind:
		| "primitive"
		| "enum"
		| "option"
		| "timestamp"
		| "option-enum"
		| "option-timestamp"
		| "option-primitive";
	enumName?: string;
}

interface TableDef {
	name: string;
	columns: ColumnType[];
}

// Parse enum definitions from types.ts
function parseEnums(content: string): EnumDef[] {
	const enums: EnumDef[] = [];

	// Match: export const EnumName = __t.enum("EnumName", { ... });
	const enumRegex =
		/export const (\w+) = __t\.enum\("(\w+)",\s*\{([^}]+)\}\);/g;

	for (const match of content.matchAll(enumRegex)) {
		const [, constName, , body] = match;

		// Extract variant names (VariantName: __t.unit())
		const variantRegex = /(\w+):\s*__t\.unit\(\)/g;
		const variants: string[] = [];
		for (const variantMatch of body.matchAll(variantRegex)) {
			variants.push(variantMatch[1]);
		}

		enums.push({ name: constName, variants });
	}

	return enums;
}

// Convert camelCase/PascalCase to snake_case for SQL column names
function toSnakeCase(str: string): string {
	return str
		.replace(/([A-Z])/g, "_$1")
		.toLowerCase()
		.replace(/^_/, "");
}

// Parse table definitions from *_table.ts files
async function parseTables(
	typesContent: string,
	bindingsDir: string,
): Promise<TableDef[]> {
	const tables: TableDef[] = [];

	// Find all table files
	const files = await fs.readdir(bindingsDir);
	const tableFiles = files.filter((f) => f.endsWith("_table.ts"));

	for (const file of tableFiles) {
		const content = await fs.readFile(path.join(bindingsDir, file), "utf-8");
		const tableName = file.replace("_table.ts", "");

		// Extract column definitions
		// Pattern: columnName: __t.type() or columnName: __t.option(__t.type())
		// Also handle: get columnName() { return TypeName; }

		const columns: ColumnType[] = [];

		// Match simple column definitions (one per line)
		// Example: assignedTo: __t.option(__t.string()).name("assigned_to"),
		const columnRegex = /^\s+(\w+):\s*(.+?)(?:,\s*$|\s*$)/gm;

		for (const colMatch of content.matchAll(columnRegex)) {
			const [, propName, typeExpr] = colMatch;

			// Skip getter-based columns (handled separately)
			if (typeExpr.includes("return")) continue;

			// Check for explicit .name("sql_name")
			const nameMatch = typeExpr.match(/\.name\("([^"]+)"\)/);
			const sqlName = nameMatch ? nameMatch[1] : toSnakeCase(propName);

			const column = analyzeType(propName, sqlName, typeExpr, typesContent);
			if (column) columns.push(column);
		}

		// Match getter-based columns (enums and Option types)
		// Example: get status() { return TaskStatus; }
		// Example: get blockedFromStatus() { return __t.option(TaskStatus).name("blocked_from_status"); }
		const getterRegex = /get\s+(\w+)\(\)\s*\{\s*return\s+([^;]+);?\s*\}/g;
		for (const match of content.matchAll(getterRegex)) {
			const [, propName, returnExpr] = match;

			// Check for explicit .name() in return expression
			const nameMatch = returnExpr.match(/\.name\("([^"]+)"\)/);
			const sqlName = nameMatch ? nameMatch[1] : toSnakeCase(propName);

			// Check if it's Option<Enum>: __t.option(EnumName)
			const optionEnumMatch = returnExpr.match(/__t\.option\((\w+)\)/);
			if (optionEnumMatch) {
				const enumName = optionEnumMatch[1];
				if (typesContent.includes(`export const ${enumName} = __t.enum`)) {
					columns.push({
						name: propName,
						sqlName,
						kind: "option-enum",
						enumName,
					});
					continue;
				}
			}

			// Check if it's Option<Timestamp>: __t.option(__t.timestamp())
			if (returnExpr.includes("__t.option(__t.timestamp())")) {
				columns.push({
					name: propName,
					sqlName,
					kind: "option-timestamp",
				});
				continue;
			}

			// Check if it's Option<primitive>: __t.option(__t.string()) or __t.option(__t.u64())
			if (returnExpr.includes("__t.option(__t.")) {
				columns.push({
					name: propName,
					sqlName,
					kind: "option-primitive",
				});
				continue;
			}

			// Check if it's just an enum name
			const simpleTypeName = returnExpr.trim();
			if (typesContent.includes(`export const ${simpleTypeName} = __t.enum`)) {
				columns.push({
					name: propName,
					sqlName,
					kind: "enum",
					enumName: simpleTypeName,
				});
			}
		}

		if (columns.length > 0) {
			tables.push({ name: tableName, columns });
		}
	}

	return tables;
}

// Analyze a type expression to determine column kind
function analyzeType(
	propName: string,
	sqlName: string,
	typeExpr: string,
	typesContent: string,
): ColumnType | null {
	// Option types
	if (typeExpr.includes("__t.option")) {
		if (typeExpr.includes("__t.timestamp")) {
			return { name: propName, sqlName, kind: "option-timestamp" };
		}
		// Check for Option<Enum>
		const enumMatch = typeExpr.match(/__t\.option\(__t\.(\w+)\)/);
		if (enumMatch) {
			const typeName = enumMatch[1];
			if (typesContent.includes(`export const ${typeName} = __t.enum`)) {
				return {
					name: propName,
					sqlName,
					kind: "option-enum",
					enumName: typeName,
				};
			}
		}
		// Option<primitive> - includes strings, u64, etc.
		return { name: propName, sqlName, kind: "option-primitive" };
	}

	// Timestamp (non-option) - must check before primitives
	if (typeExpr.includes("__t.timestamp")) {
		return { name: propName, sqlName, kind: "timestamp" };
	}

	// Primitive types (no decoder needed)
	if (
		typeExpr.includes("__t.string") ||
		typeExpr.includes("__t.u64") ||
		typeExpr.includes("__t.u32") ||
		typeExpr.includes("__t.u16") ||
		typeExpr.includes("__t.u8") ||
		typeExpr.includes("__t.bool") ||
		typeExpr.includes("__t.identity")
	) {
		return { name: propName, sqlName, kind: "primitive" };
	}

	// Array types - treat as primitive (returned as-is)
	if (typeExpr.includes("__t.array")) {
		return { name: propName, sqlName, kind: "primitive" };
	}

	return null;
}

// Generate the decoder file content
function generateDecoderFile(enums: EnumDef[], tables: TableDef[]): string {
	const lines: string[] = [
		"// THIS FILE IS AUTO-GENERATED BY scripts/generate-decoders.ts",
		"// DO NOT EDIT MANUALLY - Run `npm run generate:decoders` to regenerate",
		"",
		"/**",
		" * Algebraic type decoders for SpacetimeDB SQL query results.",
		" * Converts raw algebraic type arrays to human-readable values.",
		" */",
		"",
		"export type Decoder = (value: unknown) => unknown;",
		"",
		"// Enum decoders - map variant index to name",
		"const enumDecoders: Record<string, Decoder> = {",
	];

	// Generate enum decoders
	for (const enumDef of enums) {
		const variantsStr = enumDef.variants.map((v) => `'${v}'`).join(", ");
		lines.push(`  ${enumDef.name}: (value) => {`);
		lines.push(`    if (!Array.isArray(value)) return value;`);
		lines.push(`    const variants = [${variantsStr}];`);
		lines.push(`    return variants[value[0]] ?? \`variant_\${value[0]}\`;`);
		lines.push(`  },`);
	}

	lines.push("};");
	lines.push("");

	// Timestamp decoder
	lines.push("// Timestamp decoder - converts microseconds to ISO string");
	lines.push("const timestampDecoder: Decoder = (value) => {");
	lines.push("  if (!Array.isArray(value)) return value;");
	lines.push("  const micros = value[0];");
	lines.push(
		'  if (typeof micros !== "number" && typeof micros !== "bigint") return value;',
	);
	lines.push("  return new Date(Number(micros) / 1000).toISOString();");
	lines.push("};");
	lines.push("");

	// Option decoders
	lines.push("// Option decoder - unwraps Some, returns null for None");
	lines.push(
		"const optionDecoder = (inner?: Decoder): Decoder => (value) => {",
	);
	lines.push("  if (!Array.isArray(value)) return value;");
	lines.push("  const [tag, payload] = value;");
	lines.push("  if (tag === 1) return null; // None");
	lines.push("  // For Option<T>, payload is [T] (array with single element)");
	lines.push(
		"  // Pass the payload directly to inner decoder - it knows how to handle its format",
	);
	lines.push("  if (inner) {");
	lines.push(
		"    // Inner decoder expects the wrapped format (e.g., timestampDecoder expects [micros])",
	);
	lines.push("    return inner(payload);");
	lines.push("  }");
	lines.push("  // No inner decoder - unwrap primitives");
	lines.push(
		"  return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;",
	);
	lines.push("};");
	lines.push("");

	// Table column decoders
	lines.push("// Table column decoders");
	lines.push(
		"export const TABLE_DECODERS: Record<string, Record<string, Decoder>> = {",
	);

	for (const table of tables) {
		const complexColumns = table.columns.filter((c) => c.kind !== "primitive");
		if (complexColumns.length === 0) continue;

		lines.push(`  ${table.name}: {`);

		for (const col of complexColumns) {
			switch (col.kind) {
				case "enum":
					lines.push(`    '${col.sqlName}': enumDecoders.${col.enumName},`);
					break;
				case "option-enum":
					lines.push(
						`    '${col.sqlName}': optionDecoder(enumDecoders.${col.enumName}),`,
					);
					break;
				case "option-timestamp":
					lines.push(`    '${col.sqlName}': optionDecoder(timestampDecoder),`);
					break;
				case "option-primitive":
					lines.push(`    '${col.sqlName}': optionDecoder(),`);
					break;
				case "timestamp":
					lines.push(`    '${col.sqlName}': timestampDecoder,`);
					break;
			}
		}

		lines.push("  },");
	}

	lines.push("};");
	lines.push("");

	// Helper function to decode a row
	lines.push("/**");
	lines.push(" * Decode a row using table-specific decoders.");
	lines.push(" * @param row - The raw row from SQL query");
	lines.push(" * @param columnNames - Ordered column names from schema");
	lines.push(" * @param tableName - The table name for decoder lookup");
	lines.push(" * @returns Decoded row with human-readable values");
	lines.push(" */");
	lines.push("export function decodeRow(");
	lines.push("  row: unknown[],");
	lines.push("  columnNames: string[],");
	lines.push("  tableName?: string");
	lines.push("): Record<string, unknown> {");
	lines.push(
		"  const decoders = tableName ? TABLE_DECODERS[tableName] : undefined;",
	);
	lines.push("  const result: Record<string, unknown> = {};");
	lines.push("  ");
	lines.push("  for (let i = 0; i < columnNames.length; i++) {");
	lines.push("    const colName = columnNames[i];");
	lines.push("    const value = row[i];");
	lines.push("    const decoder = decoders?.[colName];");
	lines.push("    result[colName] = decoder ? decoder(value) : value;");
	lines.push("  }");
	lines.push("  ");
	lines.push("  return result;");
	lines.push("}");
	lines.push("");

	// Helper to infer table name from SQL query
	lines.push("/**");
	lines.push(" * Infer table name from a simple SQL query.");
	lines.push(
		' * Only works for straightforward "SELECT ... FROM table" queries.',
	);
	lines.push(" */");
	lines.push(
		"export function inferTableName(sql: string): string | undefined {",
	);
	lines.push("  const match = sql.match(/FROM\\s+(\\w+)/i);");
	lines.push("  return match?.[1]?.toLowerCase();");
	lines.push("}");

	return lines.join("\n");
}

// Main execution
async function main() {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const projectRoot = path.resolve(__dirname, "..");
	const bindingsDir = path.join(projectRoot, "src", "module_bindings");
	const generatedDir = path.join(projectRoot, "src", "generated");

	console.log("🔍 Parsing SpacetimeDB bindings...");

	// Read types.ts for enum definitions
	const typesContent = await fs.readFile(
		path.join(bindingsDir, "types.ts"),
		"utf-8",
	);

	// Parse enums
	const enums = parseEnums(typesContent);
	console.log(`📊 Found ${enums.length} enums:`);
	for (const e of enums) {
		console.log(`   - ${e.name}: ${e.variants.join(", ")}`);
	}

	// Parse tables
	const tables = await parseTables(typesContent, bindingsDir);
	console.log(`\n📋 Found ${tables.length} tables:`);
	for (const t of tables) {
		const complexCols = t.columns.filter((c) => c.kind !== "primitive");
		console.log(`   - ${t.name}: ${complexCols.length} complex columns`);
	}

	// Generate decoder file
	const decoderContent = generateDecoderFile(enums, tables);

	// Ensure generated directory exists
	await fs.mkdir(generatedDir, { recursive: true });

	// Write file
	const outputPath = path.join(generatedDir, "decoders.ts");
	await fs.writeFile(outputPath, decoderContent, "utf-8");

	console.log(`\n✅ Generated decoders at: ${outputPath}`);
	console.log("📝 Run this script after regenerating SpacetimeDB bindings");
}

main().catch((err) => {
	console.error("❌ Error:", err);
	process.exit(1);
});
