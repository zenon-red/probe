/**
 * Runtime algebraic type decoders for SpacetimeDB SQL query results.
 *
 * Builds decoder mappings from the SDK's own type metadata at import time,
 * eliminating the need for a codegen step. Converts raw algebraic type arrays
 * returned by the HTTP SQL endpoint to human-readable values.
 *
 * - Enums: [variantIndex] → "VariantName"
 * - Timestamps: [microseconds] → ISO 8601 string
 * - Options: [0, payload] → decoded payload | [1] → null
 */

import { tables } from "~/module_bindings/index.js";

export type Decoder = (value: unknown) => unknown;

const enumDecoder =
  (variants: string[]): Decoder =>
  (value) => {
    if (!Array.isArray(value)) return value;
    return variants[value[0]] ?? `variant_${value[0]}`;
  };

const timestampDecoder: Decoder = (value) => {
  if (!Array.isArray(value)) return value;
  const micros = value[0];
  if (typeof micros !== "number" && typeof micros !== "bigint") return value;
  return new Date(Number(micros) / 1000).toISOString();
};

const optionDecoder =
  (inner?: Decoder): Decoder =>
  (value) => {
    if (!Array.isArray(value)) return value;
    const [tag, payload] = value;
    if (tag === 1) return null;
    if (inner) return inner(payload);
    return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
  };

type SpacetimeType = {
  tag: string;
  value?: {
    variants?: { name?: string; algebraicType: SpacetimeType }[];
    elements?: { name?: string; algebraicType?: SpacetimeType }[];
  };
};

function isUnitProduct(st: SpacetimeType): boolean {
  return st.tag === "Product" && st.value?.elements?.length === 0;
}

export function decoderForType(st: SpacetimeType): Decoder | undefined {
  if (st.tag === "Sum" && st.value?.variants) {
    const { variants } = st.value;
    const isOption =
      variants.length === 2 && variants[0]?.name === "some" && variants[1]?.name === "none";
    if (isOption) {
      return optionDecoder(decoderForType(variants[0].algebraicType));
    }

    const variantNames: string[] = [];
    for (const variant of variants) {
      if (typeof variant.name !== "string" || !isUnitProduct(variant.algebraicType)) {
        return undefined;
      }
      variantNames.push(variant.name);
    }
    return enumDecoder(variantNames);
  }
  if (st.tag === "Product" && st.value?.elements) {
    const { elements } = st.value;
    if (elements.length === 1 && elements[0]?.name === "__timestamp_micros_since_unix_epoch__") {
      return timestampDecoder;
    }
  }
  return undefined;
}

type TableRef = {
  cols: Record<string, { columnName: string; spacetimeType: SpacetimeType }>;
};

const tableRefs = tables as Record<string, TableRef>;

export const KNOWN_TABLES = Object.keys(tableRefs);
export const TABLE_DECODERS: Record<string, Record<string, Decoder>> = {};

for (const [tableName, tableRef] of Object.entries(tableRefs)) {
  const decoders: Record<string, Decoder> = {};
  for (const colExpr of Object.values(tableRef.cols)) {
    const decoder = decoderForType(colExpr.spacetimeType);
    if (decoder) decoders[colExpr.columnName] = decoder;
  }
  if (Object.keys(decoders).length > 0) {
    TABLE_DECODERS[tableName] = decoders;
  }
}
