# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

If you discover a security vulnerability in zefer-cli, please report it responsibly:

1. **GitHub Security Advisory** (preferred): [Report a vulnerability](https://github.com/carrilloapps/zefer-cli/security/advisories/new)
2. **Email**: [m@carrillo.app](mailto:m@carrillo.app)
3. **Telegram**: [@carrilloapps](https://t.me/carrilloapps)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected component (e.g., `src/lib/crypto.ts`, `src/lib/zefer.ts`, `src/commands/decrypt.tsx`)
- Potential impact (data exposure, encryption bypass, attempt limit bypass, etc.)
- Suggested fix (if applicable)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Fix release**: As soon as possible, depending on severity

### Scope

The following are **in scope**:

- Cryptographic weaknesses in the AES-256-GCM or PBKDF2-SHA256 implementation
- Key derivation flaws (wrong iteration counts, weak salt generation)
- Authentication bypass (secret question, dual key, reveal key)
- Information leakage from the public header
- Attempt counter bypass that weakens brute-force protection
- Cross-platform password input exposure (terminal echo, process list, etc.)
- Dependency vulnerabilities with direct exploitation impact

The following are **out of scope** (by design, documented in [docs/SECURITY.md](docs/SECURITY.md)):

- `~/.zefer/attempts.json` bypass by deleting the file (client-side friction, not a guarantee — same as the web app's localStorage)
- Expiration bypass via system clock manipulation
- IP restriction bypass via proxy (IP checking is inside the encrypted payload as a deterrent, not a firewall)
- Process memory inspection during an active session
- Passphrases passed via shell arguments appearing in `ps aux` (use environment variables or interactive prompts for sensitive deployments)

## Security Architecture

zefer-cli is a 100% offline tool. No plaintext, passphrases, or encryption keys ever leave the machine.

| Primitive | Algorithm | Parameters |
|---|---|---|
| Symmetric encryption | AES-256-GCM | 256-bit key, 96-bit IV, 128-bit auth tag |
| Key derivation | PBKDF2-SHA256 | 300k / 600k / 1M iterations, 256-bit random salt |
| Answer hashing | PBKDF2-SHA256 | 100,000 iterations, SHA-256 deterministic salt |
| Random generation | `crypto.randomBytes` | OS-level CSPRNG (libuv / platform) |

For the full threat model, known limitations, and security guarantees, see [docs/SECURITY.md](docs/SECURITY.md).

## Relation to the zefer Web App

zefer-cli shares the same binary format and cryptographic parameters as [zefer.carrillo.app](https://zefer.carrillo.app). Security vulnerabilities that affect the web app's cryptographic layer (`app/lib/crypto.ts`, `app/lib/zefer.ts`) may also apply to this CLI. Please report them to both repositories or to [m@carrillo.app](mailto:m@carrillo.app).

## Acknowledgments

We appreciate responsible disclosure. Contributors who report valid vulnerabilities will be credited in the project (with permission).
