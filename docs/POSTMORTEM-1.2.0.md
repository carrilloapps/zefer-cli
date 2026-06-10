# Postmortem — zefer-cli@1.2.0 broken npm publish

**Status:** Resolved in `1.2.1` · **Date:** 2026-06-09 · **Severity:** High (package 100% unusable on install)

## Summary

`zefer-cli@1.2.0` was published to npm in a broken state. Every install crashed on
the first invocation — including `zefer --version` — with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package './chunk-XXXXXXXX.js'
imported from .../node_modules/zefer-cli/dist/index.js
```

The CLI never ran for anyone who installed 1.2.0 from npm. Standalone binaries
(GitHub Releases) were **not** affected — they bundle a single self-contained
`dist/index.mjs` and never reference code-split chunks.

## Root cause

1.2.0 added the MCP server (`zefer mcp`). That introduced two things into the
ESM build produced by `tsup.config.ts`:

- a **statically imported shared chunk** — tsup code-splitting moved common code
  into `dist/chunk-<hash>.js`, which `dist/index.js` imports at the top level; and
- a **lazily loaded server chunk** — the MCP server is reached via
  `await import("./server-<hash>.js")`, emitted as a separate output file.

`package.json` `files` was a hardcoded allowlist of exactly two paths:

```jsonc
"files": [
  "dist/index.js",
  "dist/index.js.map",
  // ...
]
```

So npm packed **only** `index.js` and its map. The chunk files it statically
`import`s were excluded from the tarball, breaking module resolution at load time.

### Why it wasn't caught before publishing

- `prepublishOnly` runs `npm run verify`, which builds and runs `node dist/index.js --version`.
  That executes against the **working `dist/`**, where the chunks exist on disk — so it passes.
- The smoke suite (`npm test`) likewise runs from the local `dist/`.
- Nothing in the pipeline ran the CLI from a **packed-then-installed** tarball,
  which is the only context that surfaces a missing-file packaging bug.

The hardcoded `files` list silently became wrong the moment the bundle started
code-splitting; nothing tied the allowlist to the actual build output.

## The fix (1.2.1)

`files` now ships every emitted JS file and sourcemap via globs, instead of a
fixed list:

```jsonc
"files": [
  "dist/*.js",
  "dist/*.js.map",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
]
```

- Covers `index.js`, `chunk-*.js`, `server-*.js`, and any future chunks — the
  content hashes in chunk names change between builds, so a glob (not a fixed
  list) is required.
- Deliberately uses `dist/*.js` rather than the whole `dist/` directory so the
  binary build's `dist/index.mjs` (from `tsup.binary.config.ts`) never leaks
  into the npm tarball.

1.2.1 is **feature-identical** to the intended 1.2.0. No source, crypto, or
`.zefer` binary-format changes — purely a packaging fix.

### Verification

The fix was validated the way the gap should have been caught: pack → install → run.

```bash
npm run build
npm pack                         # tarball now contains chunk-*.js and server-*.js
# in a clean temp dir:
npm install <path-to>/zefer-cli-1.2.1.tgz
./node_modules/.bin/zefer --version          # 1.2.1
./node_modules/.bin/zefer keygen --quiet hex # chunk import resolves
./node_modules/.bin/zefer encrypt msg.txt -p <pass>
./node_modules/.bin/zefer decrypt msg.txt.zefer -p <pass>   # round-trip OK
```

`npm pack --dry-run` before the fix listed only `dist/index.js` (+ map); after the
fix it lists all three JS bundles and their maps.

## Note on 1.2.0

npm versions are immutable — 1.2.0 cannot be republished. It remains on the
registry as a broken artifact. Consider marking it so users are redirected:

```bash
npm deprecate zefer-cli@1.2.0 "Broken package (missing build chunks). Use 1.2.1+."
```

## Follow-ups to prevent recurrence

- [ ] **Publish-from-tarball check in `verify`/CI** — `npm pack`, install the
      tarball in a temp dir, and run `zefer --version` + a keygen there, so any
      missing-file regression fails before publish (not after).
- [ ] Consider deriving `files` from the build output, or asserting in CI that
      every `dist/*.js` chunk is matched by the `files` globs.
- [ ] `npm deprecate zefer-cli@1.2.0` once 1.2.1 is live.
