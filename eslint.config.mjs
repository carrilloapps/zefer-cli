import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Flat config, mirroring the web app's setup (ESLint 10 + typescript-eslint)
 * for this Node + Ink codebase. Type correctness is already enforced by
 * `npm run typecheck` (tsc --noEmit, strict), so ESLint covers the lint layer:
 * unused code, unsafe patterns and React/Ink hook usage.
 */
export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
      ecmaVersion: "latest",
    },
  },
]);
