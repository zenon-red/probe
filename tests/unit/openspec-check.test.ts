import { describe, expect, test } from "bun:test";
import { checkOpenspecCompatForGenesis } from "../../src/utils/openspec-check.js";

describe("checkOpenspecCompatForGenesis", () => {
  test("reports warn when openspec binary missing", () => {
    const result = checkOpenspecCompatForGenesis("9.9.9");
    expect(result.status).toBe("warn");
    expect(result.expected).toBe("9.9.9");
    expect(result.fixCommand).toBe("probe upgrade --yes");
  });
});
