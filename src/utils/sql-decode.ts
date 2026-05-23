export type InferenceConfidence = "unambiguous" | "ambiguous" | "none";

export interface TableInference {
  table?: string;
  confidence: InferenceConfidence;
}

export interface QueryDecodeMeta {
  applied: boolean;
  table?: string;
  reason?: string;
  confidence?: InferenceConfidence;
}

export interface QueryDecodePolicy {
  applyDecode: boolean;
  tableName?: string;
  inference: TableInference;
  decodeMeta: QueryDecodeMeta;
}

const CLAUSE_BOUNDARY = /\s+(?:WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|FOR\s+)\b/i;

const stripTrailingSemicolon = (sql: string): string => sql.replace(/;\s*$/, "");

export function inferTableNameSafe(sql: string): TableInference {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { confidence: "none" };
  }

  if (/;\s*\S/.test(trimmed)) {
    return { confidence: "ambiguous" };
  }

  const normalized = stripTrailingSemicolon(trimmed);

  if (/\bWITH\b/i.test(normalized)) {
    return { confidence: "ambiguous" };
  }

  if (/\bJOIN\b/i.test(normalized)) {
    return { confidence: "ambiguous" };
  }

  const fromIndex = normalized.search(/\bFROM\b/i);
  if (fromIndex === -1) {
    return { confidence: "none" };
  }

  let afterFrom = normalized.slice(fromIndex + 4).trim();
  const clauseEnd = afterFrom.search(CLAUSE_BOUNDARY);
  if (clauseEnd !== -1) {
    afterFrom = afterFrom.slice(0, clauseEnd).trim();
  }

  if (!afterFrom || afterFrom.startsWith("(")) {
    return { confidence: "ambiguous" };
  }

  if (afterFrom.includes(",")) {
    return { confidence: "ambiguous" };
  }

  const match = afterFrom.match(/^([^\s]+)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/i);
  if (!match) {
    return { confidence: "none" };
  }

  const tableRef = match[1];
  if (tableRef.includes(".")) {
    return { confidence: "ambiguous" };
  }

  return { table: tableRef.toLowerCase(), confidence: "unambiguous" };
}

export function resolveQueryDecode(sql: string, shouldDecode: boolean): QueryDecodePolicy {
  const inference = inferTableNameSafe(sql);

  if (!shouldDecode) {
    return {
      applyDecode: false,
      inference,
      decodeMeta: { applied: false, reason: "decode_disabled" },
    };
  }

  if (inference.confidence === "unambiguous" && inference.table) {
    return {
      applyDecode: true,
      tableName: inference.table,
      inference,
      decodeMeta: { applied: true, table: inference.table },
    };
  }

  const reason =
    inference.confidence === "ambiguous" ? "ambiguous_table_inference" : "no_table_inferred";

  return {
    applyDecode: false,
    inference,
    decodeMeta: { applied: false, reason, confidence: inference.confidence },
  };
}
