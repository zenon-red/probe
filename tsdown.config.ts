import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  minify: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outExtensions: () => ({ js: '.js' }),
});
