import { defineConfig } from "vitest/config";

/**
 * Unit test + coverage configuration.
 *
 * `npm test` runs this suite. The integration suite (`scripts/test.mjs`,
 * `npm run test:integration`) stays separate: it drives the real built binary
 * across the CLI, MCP and library channels and is not measured here.
 *
 * Coverage covers every source file under `src/` with no exclusions and no
 * ignore hints — the whole shipped surface, at 100% on all four metrics.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/__tests__/**"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
      reporter: ["text", "text-summary"],
    },
  },
});
