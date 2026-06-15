# MCP Server — Complete Integration Guide

zefer-cli ships a built-in **[Model Context Protocol](https://modelcontextprotocol.io) server**: every capability (encrypt, decrypt, keygen, password analysis, `.zefer` inspection) becomes available to any MCP-compatible AI tool — Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Zed or your own agent.

- **Transport**: stdio, newline-delimited JSON-RPC 2.0 (the standard MCP transport)
- **Dependency-free**: no SDK required — works with the npm install, `npx`, and every standalone binary
- **100% local**: no network, no telemetry; passphrases never leave the machine

Online guide with per-tool accordions: https://zefer.carrillo.app/mcp

---

## Starting the server

| How | When it starts MCP |
|---|---|
| `zefer mcp` | Always (explicit) |
| No arguments **and** piped stdin | Automatic — this is exactly how MCP clients spawn stdio servers |
| No arguments in a human terminal (TTY) | Never — you get the regular CLI help |
| `zefer mcp --help` | Never — prints help |

This smart detection means most client configs work with either `command: "zefer", args: ["mcp"]` **or** just `command: "zefer"` — but always prefer the explicit `["mcp"]` form.

## Ways to run it

```jsonc
// A) Global install — npm install -g zefer-cli
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }

// B) npx — nothing to install (package exposes the `zefer-cli` bin)
{ "mcpServers": { "zefer": { "command": "npx", "args": ["-y", "zefer-cli", "mcp"] } } }

// C) Standalone binary — no Node.js at all
{ "mcpServers": { "zefer": { "command": "/usr/local/bin/zefer-linux-x64", "args": ["mcp"] } } }
```

> On Windows with npx, some clients require `"command": "cmd", "args": ["/c", "npx", "-y", "zefer-cli", "mcp"]`.

---

## Per-client setup

### Claude Code

Project-scoped — create `.mcp.json` at the repo root:

```json
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }
```

Or one command (project scope by default; add `-s user` for global):

```bash
claude mcp add zefer -- zefer mcp

# Without installing — register the npx form instead
claude mcp add zefer -- npx -y zefer-cli mcp
```

### Claude Desktop

Settings → Developer → **Edit Config** (`claude_desktop_config.json`):

```json
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }
```

Restart Claude Desktop afterwards.

### Cursor

Project: `.cursor/mcp.json` · Global: `~/.cursor/mcp.json`

```json
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }
```

### VS Code (Copilot agent mode)

`.vscode/mcp.json` — note the different `servers` + `type` shape:

```json
{ "servers": { "zefer": { "type": "stdio", "command": "zefer", "args": ["mcp"] } } }
```

### Zed

`settings.json` → `context_servers`:

```json
{ "context_servers": { "zefer": { "command": { "path": "zefer", "args": ["mcp"] } } } }
```

### Any other client / custom agent

Spawn `zefer mcp` (or `npx -y zefer-cli mcp`) as a child process and speak
newline-delimited JSON-RPC 2.0 over its stdin/stdout. Supported methods:
`initialize`, `ping`, `tools/list`, `tools/call`, plus silent acceptance of
notifications (`notifications/initialized`).

---

## Tools reference

### `zefer_encrypt`

Encrypt text or a file into a `.zefer` file. Provide `text` **or** `inputPath`.

| Parameter | Type | Notes |
|---|---|---|
| `passphrase` | string, **required** | Min 6 characters |
| `text` | string | Text to encrypt |
| `inputPath` | string | File to encrypt |
| `outputPath` | string | Default `<input>.zefer` / `encrypted.zefer` |
| `secondPassphrase` | string | Dual-key (two-person authorization) |
| `revealKey` | string | Recipients decrypt without the main key (ZEFR3) |
| `hint`, `note` | string | Public (visible without the passphrase) |
| `question`, `questionAnswer` | string | Secret question (answer PBKDF2-hashed) |
| `ttlMinutes` | number | Expiration (0 = never) |
| `iterations` | number | PBKDF2 iterations (default 600000) |
| `compression` | `none\|gzip\|deflate\|deflate-raw` | Before encryption |
| `maxAttempts` | number | 0 = unlimited |
| `allowedIps` | string[] | IPv4/IPv6 allowlist (stored encrypted) |

Returns: `{ outputPath, sizeBytes, format, expiresAt }`.

### `zefer_decrypt`

| Parameter | Type | Notes |
|---|---|---|
| `inputPath` | string, **required** | `.zefer` file |
| `passphrase` | string, **required** | Main passphrase or reveal key |
| `secondPassphrase` | string | For dual-key files |
| `questionAnswer` | string | If the file requires it |
| `outputPath` | string | File mode destination |
| `overwrite` | boolean | Default false |

Text content is returned inline (`{ content }`); files are written to disk (`{ writtenTo, fileName, sizeBytes }`).

### `zefer_keygen`

| Parameter | Type | Notes |
|---|---|---|
| `mode` | `unicode\|secure\|alpha\|hex\|base58\|pin\|uuid` | Default `secure` |
| `length` | number | 1–2048 (default 64; ignored for uuid) |
| `count` | number | 1–50 (default 1) |
| `excludeAmbiguous` | boolean | Drop `0 O 1 l I` |
| `excludeChars` | string | Custom exclusions |
| `requireAllClasses` | boolean | Guarantee lower/upper/digit/symbol |
| `noRepeats` | boolean | No consecutive repeats |
| `groupSize` | number | Dash every N chars (cosmetic) |

Returns keys **scored and sorted strongest first**: `{ keys: [{ value, score, scoreLabel, effectiveEntropyBits }] }`.

### `zefer_analyze_password`

`{ password }` → full report: score, estimated alphabet, max/effective entropy, total keyspace, post-quantum bits (Grover), crack time across 4 attack scenarios (10²–10¹⁵ guesses/s), NIST SP 800-63B / OWASP / long-term / AES-128 / post-quantum compliance, weaknesses, and a comparison vs an average human password (~40 bits).

### `zefer_inspect`

`{ inputPath }` → deep analysis **without the passphrase**: public header (format, mode, iterations + KDF level, compression, hint/note), structural integrity (chunk-framing walk), encrypted chunk count, estimated content size, ciphertext Shannon entropy, salt/IV hex, file SHA-256, a KDF resistance table derived from the file's actual iterations, and severity-tagged security observations.

---

## Wire example

Request (one JSON object per line on stdin):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zefer_encrypt","arguments":{"text":"api_key=abc123","passphrase":"my-strong-pass","outputPath":"secret.zefer","ttlMinutes":1440,"compression":"gzip"}}}
```

Response (one line on stdout):

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\n  \"outputPath\": \"/work/secret.zefer\",\n  \"sizeBytes\": 372,\n  \"format\": \"ZEFB3\",\n  \"expiresAt\": \"2026-06-06T12:00:00.000Z\"\n}"}],"isError":false}}
```

Manual smoke test from a shell:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | zefer mcp
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Client says the server "didn't start" | The `zefer` bin is not on the client's PATH — use the npx form or an absolute path |
| `zefer` hangs in a script | No args + piped stdin = MCP mode by design. Pass a command (`zefer keygen …`) or close stdin |
| Tool errors with `isError: true` | The message explains it (wrong passphrase, file exists without `overwrite`, invalid mode…) — errors are returned as tool results, not protocol failures |
| Windows + npx | Wrap with `cmd /c` (see note above) |

Everything is implemented in [`src/mcp/server.ts`](../src/mcp/server.ts) — ~400 lines, no dependencies, easy to audit.
