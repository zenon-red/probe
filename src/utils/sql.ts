export interface SqlColumn {
	name: string;
	type: string;
}

export interface SqlSchema {
	columns: SqlColumn[];
}

export interface SqlStatementResult {
	schema: SqlSchema | unknown;
	rows: unknown[];
}

export interface SqlRowObject {
	[key: string]: unknown;
}

export interface SqlSchemaElement {
	name: { some?: string } | string;
	algebraic_type?: unknown;
	type?: string;
}

export interface SqlSchemaAlt {
	elements?: SqlSchemaElement[];
}

const extractColumnName = (element: SqlSchemaElement): string | undefined => {
	if (typeof element.name === "string") {
		return element.name;
	}
	if (
		element.name &&
		typeof element.name === "object" &&
		"some" in element.name
	) {
		return element.name.some;
	}
	return undefined;
};

export interface SqlRequestOptions {
	host: string;
	moduleName: string;
	token: string;
	sql: string;
	timeoutMs: number;
}

export interface SqlRequestSuccess {
	results: SqlStatementResult[];
	durationMs: number;
}

export class SqlRequestError extends Error {
	readonly status: number;
	readonly responseBody: string;

	constructor(status: number, responseBody: string, message?: string) {
		super(message || `SQL request failed with status ${status}`);
		this.name = "SqlRequestError";
		this.status = status;
		this.responseBody = responseBody;
	}
}

export const normalizeSqlHttpBase = (host: string): string => {
	const url = new URL(host);
	if (url.protocol === "ws:") {
		url.protocol = "http:";
	} else if (url.protocol === "wss:") {
		url.protocol = "https:";
	} else if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported host protocol: ${url.protocol}`);
	}
	return url.toString();
};

export const buildSqlEndpoint = (host: string, moduleName: string): string => {
	const base = normalizeSqlHttpBase(host);
	const url = new URL(base);
	const basePath = url.pathname.replace(/\/$/, "");
	url.pathname = `${basePath}/v1/database/${encodeURIComponent(moduleName)}/sql`;
	return url.toString();
};

const parseResults = (payload: unknown): SqlStatementResult[] => {
	if (!Array.isArray(payload)) {
		throw new Error(
			"Invalid SQL response: expected array of statement results",
		);
	}
	return payload.map((statement) => {
		const record = statement as { schema?: unknown; rows?: unknown };
		const rows = Array.isArray(record.rows) ? record.rows : [];
		return {
			schema: record.schema,
			rows,
		};
	});
};

export const executeSqlRequest = async (
	options: SqlRequestOptions,
): Promise<SqlRequestSuccess> => {
	const endpoint = buildSqlEndpoint(options.host, options.moduleName);
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
	const started = Date.now();

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.token}`,
				"Content-Type": "text/plain",
				Accept: "application/json",
			},
			body: options.sql,
			signal: controller.signal,
		});

		const responseText = await response.text();
		if (!response.ok) {
			throw new SqlRequestError(response.status, responseText);
		}

		let parsed: unknown;
		try {
			parsed = responseText ? JSON.parse(responseText) : [];
		} catch {
			throw new Error("Invalid SQL response: expected JSON payload");
		}

		return {
			results: parseResults(parsed),
			durationMs: Date.now() - started,
		};
	} finally {
		clearTimeout(timeoutHandle);
	}
};

// Extract column names from schema for use in responses
export const extractColumnNames = (result: SqlStatementResult): string[] => {
	const schema = result.schema as SqlSchema | SqlSchemaAlt | undefined;

	if (schema && "elements" in schema && Array.isArray(schema.elements)) {
		return schema.elements
			.map(extractColumnName)
			.filter((name): name is string => name !== undefined);
	} else if (schema && "columns" in schema && Array.isArray(schema.columns)) {
		return schema.columns.map((col) => col.name);
	}

	return [];
};

// Parse SQL error to provide helpful suggestions
export const parseSqlError = (
	responseBody: string,
): { message: string; suggestion?: string } => {
	// Try to parse as JSON first, fallback to plain text
	let errorMsg: string;
	try {
		const parsed = JSON.parse(responseBody);
		errorMsg = parsed.error || responseBody;
	} catch {
		errorMsg = responseBody;
	}

	// Common SpacetimeDB SQL errors with suggestions
	if (errorMsg.includes("ORDER BY")) {
		return {
			message: errorMsg,
			suggestion:
				"SpacetimeDB SQL does not support ORDER BY. Remove it or filter/sort results locally.",
		};
	}
	if (errorMsg.includes("IS NULL") || errorMsg.includes("IS NOT NULL")) {
		return {
			message: errorMsg,
			suggestion:
				'Use "column = NULL" or "column != NULL" instead of IS NULL / IS NOT NULL.',
		};
	}
	if (errorMsg.includes("JOIN")) {
		return {
			message: errorMsg,
			suggestion:
				"SpacetimeDB has limited JOIN support. Try querying single tables or use multiple queries.",
		};
	}
	if (errorMsg.includes("no such table")) {
		return {
			message: errorMsg,
			suggestion:
				"Check the table name. Common tables: tasks, projects, agents, ideas, messages.",
		};
	}
	if (errorMsg.includes("no such column")) {
		return {
			message: errorMsg,
			suggestion:
				"Check the column name. Use SELECT * to see all available columns.",
		};
	}

	return { message: errorMsg };
};
