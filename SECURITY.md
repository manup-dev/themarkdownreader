# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | Active support     |
| < 1.0   | No support         |

## Reporting a Vulnerability

If you discover a security vulnerability in md-reader, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@themarkdownreader.com**

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to expect

- **Acknowledgment** within 48 hours
- **Status update** within 7 days
- **Fix timeline** depends on severity:
  - Critical: patch within 72 hours
  - High: patch within 1 week
  - Medium/Low: next release cycle

### Scope

The following are in scope:
- XSS, injection, or code execution in the web app
- Path traversal in the file API or MCP server
- Data leakage (telemetry sending PII, IndexedDB exposure)
- Dependency vulnerabilities with known exploits

The following are out of scope:
- Self-XSS (user injecting into their own session)
- Issues requiring physical access to the user's machine
- Vulnerabilities in third-party services (OpenRouter, Ollama)

## Security Architecture

- **Local-first**: Files are processed client-side. No server uploads.
- **Telemetry**: Opt-in only. Never tracks file contents, names, or user data.
- **SSRF protection**: URL fetching blocks private IP ranges and localhost.
- **Path validation**: File API and MCP server restrict to `.md` files within allowed roots.
- **CSP**: No inline scripts. All assets served from same origin.
