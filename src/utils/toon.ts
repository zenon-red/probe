import { encode } from "@toon-format/toon";

export function formatToon(data: Record<string, unknown>): string {
	return encode(data);
}

export function formatToonRecord<T extends object>(
	key: string,
	items: T[],
	fields?: (keyof T)[],
): string {
	const displayFields = fields || (Object.keys(items[0] || {}) as (keyof T)[]);
	const rows = items.map((item) => {
		const row: Record<string, unknown> = {};
		for (const field of displayFields) {
			row[String(field)] = item[field];
		}
		return row;
	});
	return encode({ [key]: rows });
}

export function toonList<T extends object>(
	key: string,
	items: T[],
	columns?: string[],
): string {
	if (items.length === 0) {
		return encode({ [key]: [] });
	}

	const cols = columns || Object.keys(items[0] as Record<string, unknown>);
	const rows = items.map((item) => {
		const row: Record<string, unknown> = {};
		for (const col of cols) {
			row[col] = (item as Record<string, unknown>)[col];
		}
		return row;
	});
	return encode({ [key]: rows });
}
