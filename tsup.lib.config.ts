import { defineConfig } from "tsup";

/**
 * Library build — produces the importable programmatic API.
 *
 *   dist/lib.js     ESM bundle      (exports['.'].import)
 *   dist/lib.cjs    CommonJS bundle (exports['.'].require)
 *   dist/lib.d.ts   ESM types
 *   dist/lib.d.cts  CJS types
 *
 * No shebang banner (this is a library, not an executable) and `clean: false`
 * so it runs AFTER the CLI build (`tsup.config.ts`) without wiping dist/.
 *
 * The entry only pulls in `src/lib/*` — no Ink, React or Commander — so the
 * bundle stays small and free of terminal-UI side effects.
 */
export default defineConfig({
  entry: { lib: "src/lib.ts" },
  format: ["esm", "cjs"],
  target: "node20",
  clean: false,
  sourcemap: true,
  dts: true,
  splitting: false,
  banner: {},
});
