# Security Policy

## Supported Versions

| Product                          | Version | Supported          |
|----------------------------------|---------|--------------------|
| md-reader (web app)              | 1.x     | Active support     |
| md-reader (web app)              | < 1.0   | No support         |
| jupyterlab-md-reader (JL ext.)   | 0.3.x   | Active support     |
| jupyterlab-md-reader (JL ext.)   | < 0.3   | No support         |

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
- **Telemetry**: Opt-in only. Never tracks file contents, names, or user data. **Compiled out entirely in the JupyterLab iframe build** (`vite.jupyter.config.ts` replaces `posthog-js` with a no-op proxy and defines `MDR_TELEMETRY=0`).
- **SSRF protection**: URL fetching blocks private IP ranges and localhost.
- **Path validation**: File API and MCP server restrict to `.md` files within allowed roots.
- **CSP**: No inline scripts. All assets served from same origin.

### JupyterLab extension (`jupyterlab-md-reader`)

The JL extension embeds the web app as a same-origin iframe and adds its own boundary:

- **Wire protocol** (`packages/jupyterlab/src/bridge/MessageBridge.ts` / `src/lib/iframe-bridge.ts`): versioned envelopes, per-panel handshake nonce minted with `crypto.randomUUID` (fail-closed without Web Crypto — no `Math.random` fallback), origin pinning, and per-direction sequence-number replay protection.
- **CLI input validation** (`packages/jupyterlab/jupyterlab_md_reader/cli.py`): `_assert_safe_http_url` raises on non-http(s) schemes; defensive `isinstance` guards on every JSON field returned by the Ollama daemon.
- **API key handling**: `redactOpenRouterKey()` in `src/lib/ai.ts` runs on every OpenRouter error path so an upstream proxy that echoes the Authorization header can never leak it into a console log or toast.
- **Externalized framework deps**: `sanitize-html` and the rest of the `@jupyterlab/*` chain are NOT bundled in our wheel. `@jupyterlab/builder` externalizes them and the user's installed JupyterLab provides them at runtime. JupyterLab framework CVEs should be tracked at <https://github.com/jupyterlab/jupyterlab/security/advisories>.

## Dependency monitoring

We rely on three layers, in order of latency:

1. **GitHub Dependabot** (`.github/dependabot.yml`) — opens PRs against `master` immediately for any security advisory in our shipped dependency surface (npm + pip + GitHub Actions). Non-security minor/patch updates batch weekly. Major-version bumps are deliberately suppressed so they land as deliberate, human-opened PRs.
2. **Weekly audit workflow** (`.github/workflows/security-audit.yml`) — runs every Monday 06:00 UTC and on every PR that touches dependency manifests. Fails the build on `high` or `critical` advisories; tolerates `moderate` (we'd otherwise be permanently red on upstream-tracked items like `sanitize-html`). Surfaces a fresh tracking issue when the cron run goes red.
3. **`overrides` block in `package.json`** — last-mile escape hatch for transitive vulnerabilities. Force-pins to fixed versions without waiting for upstream propagation. Each entry should be reviewed and removed once the parent dep ships a clean release on its own.

A dependency CVE that lands in our shipped surface should be patched within the SLAs above. If you observe a critical/high advisory that *hasn't* been auto-PR'd within 24h of publication, please email the address above so we can investigate.
