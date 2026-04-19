/**
 * ESM bundle for pkg — produces dist/index.mjs with all dependencies inlined.
 *
 * We keep ESM format (not CJS) because:
 *   - yoga-layout (used by Ink) uses top-level await + WebAssembly
 *   - Top-level await is only allowed in ESM; CJS conversion breaks it
 *
 * react-devtools-core is an optional Ink dependency only loaded in dev mode.
 * It's not installed and never called at runtime, so we stub it with an
 * empty module via an esbuild plugin.
 */

import { defineConfig } from "tsup";
import type { Plugin } from "esbuild";

/** Replaces react-devtools-core with an empty module stub. */
const stubDevtools: Plugin = {
  name: "stub-react-devtools-core",
  setup(build) {
    build.onResolve({ filter: /react-devtools-core/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default null;",
    }));
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: false, // preserve dist/index.js from the npm ESM build
  sourcemap: false,
  outExtension: () => ({ js: ".mjs" }),
  // Bundle every import so pkg gets a single self-contained file
  noExternal: [/.*/],
  // Single output file — pkg cannot resolve dynamic chunk imports at runtime
  splitting: false,
  esbuildPlugins: [stubDevtools],
  // No shebang — pkg adds the native executable header for each OS
  banner: {},
});
