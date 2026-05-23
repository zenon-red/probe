import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { inferTableName, TABLE_DECODERS } from "~/generated/decoders.js";
import { getConfig, resolveSpacetimeArgs } from "~/utils/config.js";
import { printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import {
  executeSqlRequest,
  extractColumnNames,
  parseSqlError,
  SqlRequestError,
  type SqlStatementResult,
} from "~/utils/sql.js";
import { getCachedToken } from "~/utils/token-cache.js";
import { getWalletInfo } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";
import { NETWORK_TIMEOUT } from "~/utils/timeouts.js";

const KNOWN_TABLES = Object.keys(TABLE_DECODERS);

const handleQueryError = (err: unknown, timeoutMs: number): never => {
  if (err instanceof SqlRequestError) {
    if (err.status === 401) {
      error("AUTH_REQUIRED", "Authentication required. Run `probe auth <wallet> --save` first.");
    }
    const { message, suggestion } = parseSqlError(err.responseBody);
    if (err.status === 400) {
      error("SQL_INVALID", message, suggestion);
    }
    error("SQL_FAILED", message, suggestion);
  }

  if (err instanceof Error && err.name === "AbortError") {
    error("SQL_UNAVAILABLE", `SQL request timed out after ${timeoutMs}ms`);
  }

  error("SQL_UNAVAILABLE", errorMessage(err, "SQL request failed"));
};

const DEFAULT_TIMEOUT_MS = NETWORK_TIMEOUT.DEFAULT;

const buildMeta = (results: SqlStatementResult[], durationMs: number) => ({
  duration_ms: durationMs,
  query_count: results.length,
  row_count_total: results.reduce((sum, item) => sum + item.rows.length, 0),
});

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

const buildFlatResponse = (
  results: SqlStatementResult[],
  shouldDecode: boolean,
  tableName?: string,
): Record<string, QueryResult> => {
  const response: Record<string, QueryResult> = {};

  for (let index = 0; index < results.length; index += 1) {
    const statement = results[index];
    const columns = extractColumnNames(statement);
    const decoders = shouldDecode && tableName ? TABLE_DECODERS[tableName] : undefined;

    const rowObjects = (statement.rows as unknown[][]).map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        const colName = columns[i];
        const value = row[i];
        const decoder = decoders?.[colName];
        obj[colName] = decoder ? decoder(value) : value;
      }
      return obj;
    });

    response[`query_${index + 1}`] = { columns, rows: rowObjects };
  }

  if (results.length === 0) {
    response.query_1 = { columns: [], rows: [] };
  }

  return response;
};

export default defineCommand({
  meta: {
    name: "query",
    description: "Run SQL read queries against Nexus",
  },
  args: {
    sql: {
      type: "positional",
      description: "SQL query string",
      required: false,
    },
    file: {
      type: "string",
      description: "Read SQL from file path",
    },
    wallet: {
      type: "string",
      description: "Wallet name override",
    },
    host: {
      type: "string",
      description: "SpacetimeDB host override",
    },
    module: {
      type: "string",
      description: "SpacetimeDB module override",
    },
    timeout: {
      type: "string",
      description: "Request timeout in milliseconds",
    },
    meta: {
      type: "boolean",
      description: "Include metadata in output",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
    tables: {
      type: "boolean",
      description: "List all available tables",
      default: false,
    },
    decode: {
      type: "boolean",
      description: "Decode algebraic types to human-readable values",
      default: true,
    },
    raw: {
      type: "boolean",
      description: "Output raw algebraic type arrays (no decoding)",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    const hasSql = args.sql || args.file;

    if (args.tables) {
      success({ tables: KNOWN_TABLES });
      return;
    }

    if (!hasSql) {
      printHelp({
        command: "probe query",
        description: "Execute SQL against the configured Nexus SpacetimeDB module",
        usage: [
          'probe query "SELECT * FROM tasks LIMIT 5"',
          "probe query --file ./query.sql --meta",
          "probe query --tables",
        ],
        options: [
          { name: "--file", detail: "Read SQL from file" },
          {
            name: "--wallet",
            detail: "Wallet override (defaults to config defaultWallet)",
          },
          {
            name: "--host, --module",
            detail: "Nexus SpacetimeDB target overrides",
          },
          {
            name: "--timeout",
            detail: `Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`,
          },
          { name: "--meta", detail: "Include metadata in output" },
          { name: "--json", detail: "JSON output mode with keyed objects" },
          { name: "--tables", detail: "List all available tables" },
          {
            name: "--decode",
            detail: "Decode algebraic types (default: true)",
          },
          {
            name: "--raw",
            detail: "Output raw algebraic arrays (no decoding)",
          },
        ],
        notes: [
          "This command is read-only and intended for SQL queries against Nexus tables.",
          'Output returns keyed objects: {"query_1": {"columns": [...], "rows": [{"id": 1, ...}]}}',
          "Use --raw to see raw SpacetimeDB algebraic type arrays.",
        ],
      });
      return;
    }

    const timeoutMs = args.timeout ? Number.parseInt(args.timeout, 10) : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      error("INVALID_TIMEOUT", `Invalid timeout: ${args.timeout}`);
    }

    const config = await getConfig();
    const walletName = args.wallet || config.defaultWallet;
    if (!walletName) {
      error("WALLET_REQUIRED", "Wallet required. Use --wallet or set default wallet.");
    }

    const wallet = await getWalletInfo(walletName);
    if (!wallet) {
      error("WALLET_NOT_FOUND", `Wallet not found: ${walletName}`);
    }

    const cached = await getCachedToken(walletName);
    if (!cached) {
      error("AUTH_REQUIRED", "No cached token. Run `probe auth <wallet> --save` first.");
    }

    const { host, module: moduleName } = resolveSpacetimeArgs(args, config);
    const sql = args.file ? await readFile(args.file, "utf-8") : (args.sql ?? "");
    if (!sql.trim()) {
      error("SQL_REQUIRED", "SQL query is empty");
    }

    const shouldDecode = args.raw ? false : (args.decode ?? true);
    const tableName = inferTableName(sql);

    try {
      const { results, durationMs } = await executeSqlRequest({
        host,
        moduleName,
        token: cached.token,
        sql,
        timeoutMs,
      });

      const flatResponse = buildFlatResponse(results, shouldDecode, tableName);
      if (args.meta) {
        success({ ...flatResponse, meta: buildMeta(results, durationMs) });
      } else {
        success(flatResponse);
      }
    } catch (err) {
      handleQueryError(err, timeoutMs);
    }
  },
});
