export const SAMPLE_MARKDOWN = `# md-reader — Read it. Ship it.

> Comprehend. Then act. Without the alt-tab.

This is the sample document — a realistic agent-generated spec. Read it to see how md-reader works, then try the **Ship-it** flow on the practice passage below — that's the half that makes md-reader different from every other markdown reader.

## Why md-reader exists

Reading and shipping are two distinct problems, and no existing tool handles both. NotebookLM helps you understand a doc but leaves you stranded when it's time to act. Claude Code, Codex, and Cursor happily implement anything you paste — but assume you already understood it. So you read in one tab, alt-tab to your agent, retype the context, lose the line references, and pray.

md-reader closes that gap. One app, both halves.

## 📖 Read it — six ways to understand any doc

md-reader gives you complementary views of the same document.

### Visual structure

- **Mind map** — auto-generated structural overview (try the tab above — this very document becomes a 3-level tree)
- **Treemap** — section sizes at a glance, biggest ideas first
- **Knowledge graph** — AI-extracted concept network

### Listen instead

- **Podcast** — two AI voices discussing this doc, generated on your GPU. Great for commute reading. Find it under the **Mode** menu.
- **Smart TTS** — neural narration that skips code blocks and syntax. The speaker icon in the bottom-right toolbar.

### Ask and learn

- **AI tutor** — the Coach tab explains each section and quizzes your comprehension
- **Chat Q&A** — the chat bubble (bottom-right) answers questions with section citations

## 🚀 Ship it — highlight, comment, send to your coding agent

This is where md-reader becomes different. Below is a slice of a real auth-service spec — the kind Claude Code writes for you every day.

### The practice passage

> The authentication middleware validates JWTs using RS256. Tokens must carry a \`scopes\` claim with space-separated values. Missing tokens respond with \`401 Unauthorized\`. Expired tokens respond with \`401 Token expired\`. Revoked tokens respond with \`403 Token revoked\`. All failures must be logged to the audit log with a correlation ID passed via the \`X-Correlation-Id\` header.

### The spec your agent wrote

#### Token validation rules

| Case | Response | Audit event |
| --- | --- | --- |
| Missing token | \`401 Unauthorized\` | \`auth.missing\` |
| Expired token | \`401 Token expired\` | \`auth.expired\` |
| Revoked token | \`403 Token revoked\` | \`auth.revoked\` |
| Bad signature | \`401 Unauthorized\` | \`auth.bad_sig\` |

#### Reference implementation sketch

\`\`\`typescript
export async function authMiddleware(req: Request): Promise<Verdict> {
  const token = bearer(req)
  if (!token) return deny(401, 'Unauthorized', 'auth.missing')
  const claims = await verifyRS256(token, jwks)
  if (claims.exp < now()) return deny(401, 'Token expired', 'auth.expired')
  if (await isRevoked(claims.jti)) return deny(403, 'Token revoked', 'auth.revoked')
  return allow(parseScopes(claims.scopes))
}
\`\`\`

#### Open questions for review

1. Should \`auth.bad_sig\` failures rate-limit the calling IP?
2. Is the JWKS cache TTL (5 min) acceptable for key rotation?

### Try this right now

1. **Select** the quoted practice passage above — click-drag to highlight it.
2. **Click** the action button that appears in the selection menu.
3. **Leave a comment** describing what you want built, e.g. *"implement this middleware with unit tests for each response code."*
4. **One click** ships a Claude Code–ready prompt with exact \`file:line\` references straight to your clipboard — or, with the VS Code extension installed, into the terminal where \`claude\` is already running.

Your agent gets the exact passage, the line references, and your intent in one atomic action. No alt-tab. No retyping. No lost context.

## Three ways to bring your own docs

1. **Drag a markdown file** onto the upload screen
2. **Paste a URL** to a raw markdown file and hit Fetch
3. **Pipe from stdin** in your terminal: \`cat README.md | npx md-reader\`

md-reader also ships as a **VS Code extension** (read markdown alongside your code), a **Chrome extension** (one-click "Open in md-reader" on any \`.md\` file on GitHub), and a **CLI** (\`npx md-reader\`) — so the Read-it / Ship-it loop follows you everywhere you already read docs.

## How AI works

md-reader supports **three AI backends**, auto-detected based on your setup:

1. **Ollama (local GPU)** — best quality, fully private, runs on your machine
2. **WebLLM (in-browser)** — no install needed, runs entirely in your browser via WebGPU (Chrome / Edge)
3. **OpenRouter (cloud)** — free-tier models via an API key you provide

md-reader picks the best option your hardware supports. On a browser without WebGPU (Safari, Firefox, most phones), the gear icon walks you through a free 30-second cloud setup instead.

### Privacy first

- **No server** — everything runs in your browser or on your laptop
- **No tracking** — zero analytics by default
- **No uploads** — your files never leave your device
- **Open source** — MIT licensed, inspect every line of code

---

*Ready? Try the Ship-it flow on the practice passage above, then drop your own markdown file to start reading for real.*
`
