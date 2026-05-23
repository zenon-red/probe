import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildEnumVariants, parseEnums } from "../../scripts/generate-decoders";
import { ENUM_VARIANTS } from "../../src/generated/decoders.js";

const bindingsTypesPath = path.join(process.cwd(), "src/module_bindings/types.ts");

describe("schema drift", () => {
  it("generated ENUM_VARIANTS matches bindings enums", async () => {
    const typesContent = await readFile(bindingsTypesPath, "utf-8");
    const expected = buildEnumVariants(parseEnums(typesContent));

    expect(Object.keys(ENUM_VARIANTS).sort()).toEqual(Object.keys(expected).sort());

    for (const enumName of Object.keys(expected)) {
      expect(ENUM_VARIANTS[enumName]).toEqual(expected[enumName]);
    }
  });
});
