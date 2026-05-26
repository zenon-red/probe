import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
  description: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  minify: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtensions: () => ({ js: ".js" }),
  define: {
    __PROBE_VERSION__: JSON.stringify(pkg.version),
    __PROBE_DESCRIPTION__: JSON.stringify(pkg.description),
  },
});
