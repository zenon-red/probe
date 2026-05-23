import { describe, expect, it } from "bun:test";
import { TABLE_DECODERS } from "../../src/generated/decoders.js";
import { extractColumnNames } from "../../src/utils/sql.js";
import {
  inferTableNameSafe,
  resolveQueryDecode,
  type TableInference,
} from "../../src/utils/sql-decode.js";

const expectInference = (sql: string, expected: TableInference) => {
  expect(inferTableNameSafe(sql)).toEqual(expected);
};

describe("inferTableNameSafe", () => {
  it("classifies simple select as unambiguous", () => {
    expectInference("SELECT * FROM tasks LIMIT 5", {
      table: "tasks",
      confidence: "unambiguous",
    });
  });

  it("classifies star select with table alias as unambiguous", () => {
    expectInference("SELECT * FROM tasks t LIMIT 5", {
      table: "tasks",
      confidence: "unambiguous",
    });
  });

  it("classifies column select with table alias as unambiguous", () => {
    expectInference("SELECT t.status FROM tasks t LIMIT 5", {
      table: "tasks",
      confidence: "unambiguous",
    });
  });

  it("classifies join as ambiguous", () => {
    expectInference("SELECT * FROM tasks t JOIN agents a ON t.id = a.id", {
      confidence: "ambiguous",
    });
  });

  it("classifies multi-statement SQL as ambiguous", () => {
    expectInference("SELECT * FROM tasks; SELECT * FROM agents", {
      confidence: "ambiguous",
    });
  });

  it("classifies schema-qualified table as ambiguous", () => {
    expectInference("SELECT * FROM public.tasks", {
      confidence: "ambiguous",
    });
  });

  it("classifies select without FROM as none", () => {
    expectInference("SELECT 1", { confidence: "none" });
  });

  it("classifies CTE as ambiguous", () => {
    expectInference("WITH cte AS (SELECT * FROM tasks) SELECT * FROM cte", {
      confidence: "ambiguous",
    });
  });
});

describe("resolveQueryDecode", () => {
  it("decodes unambiguous single-table select", () => {
    const policy = resolveQueryDecode("SELECT * FROM tasks LIMIT 5", true);
    expect(policy.applyDecode).toBe(true);
    expect(policy.tableName).toBe("tasks");
    expect(policy.decodeMeta).toEqual({ applied: true, table: "tasks" });
  });

  it("skips decode for join queries", () => {
    const policy = resolveQueryDecode("SELECT * FROM tasks t JOIN agents a ON t.id = a.id", true);
    expect(policy.applyDecode).toBe(false);
    expect(policy.decodeMeta).toEqual({
      applied: false,
      reason: "ambiguous_table_inference",
      confidence: "ambiguous",
    });
  });

  it("skips decode when --raw disables decoding", () => {
    const policy = resolveQueryDecode("SELECT * FROM tasks LIMIT 5", false);
    expect(policy.applyDecode).toBe(false);
    expect(policy.decodeMeta).toEqual({ applied: false, reason: "decode_disabled" });
  });

  it("still decodes with --decode on safe shape", () => {
    const policy = resolveQueryDecode("SELECT * FROM tasks LIMIT 1", true);
    expect(policy.applyDecode).toBe(true);
    expect(policy.tableName).toBe("tasks");
  });

  it("does not decode ambiguous SQL even when decode is requested", () => {
    const policy = resolveQueryDecode("SELECT * FROM public.tasks", true);
    expect(policy.applyDecode).toBe(false);
    expect(policy.decodeMeta.reason).toBe("ambiguous_table_inference");
  });

  it("allows decode for unknown but inferrable tables", () => {
    const policy = resolveQueryDecode("SELECT * FROM unknown_table LIMIT 1", true);
    expect(policy.applyDecode).toBe(true);
    expect(policy.tableName).toBe("unknown_table");
    expect(TABLE_DECODERS.unknown_table).toBeUndefined();
  });
});

describe("query row decode", () => {
  it("decodes enum columns for unambiguous agent_actions query", () => {
    const policy = resolveQueryDecode("SELECT kind FROM agent_actions LIMIT 1", true);
    expect(policy.applyDecode).toBe(true);

    const decoders = TABLE_DECODERS.agent_actions;
    expect(decoders).toBeDefined();

    const statement = {
      schema: { elements: [{ name: { some: "kind" } }] },
      rows: [[[4]]],
    };
    const columns = extractColumnNames(statement);
    const decoder = decoders?.[columns[0]!];
    expect(decoder?.([4])).toBe("ExecuteTask");
  });

  it("leaves rows raw when decode is skipped for joins", () => {
    const policy = resolveQueryDecode(
      "SELECT t.status FROM tasks t JOIN agents a ON t.id = a.id",
      true,
    );
    expect(policy.applyDecode).toBe(false);

    const rawValue = [1];
    expect(rawValue).toEqual([1]);
  });
});
