# jupyterlab-md-reader

Local-first, AI-assisted markdown reader for **JupyterLab 4.x**. Open any `.md` file inside Lab and get a full reading workstation — table of contents, highlights, mind map, knowledge graph, treemap, RAG-grounded chat, and a coach mode — without leaving the browser.

The full md-reader web app is embedded as a same-origin iframe with a versioned postMessage bridge to the JL host. A native JL companion panel adds an Outline view that stays in sync as you edit.

## Install

```bash
pip install jupyterlab-md-reader
```

Requires JupyterLab `>=4,<5` and Python `>=3.9`.

After install, right-click any `.md` file in the file browser and pick **Open with → Markdown Reader**, or run the command **Markdown Reader: Open** from the palette (`Ctrl/Cmd-Shift-C`).

## What's in 0.3.0

- **Reader** — table of contents, headings outline, highlights, mind map (Markmap), treemap (D3), knowledge graph (Cytoscape), Mermaid + KaTeX rendering
- **Companion panel** — JL-native sidebar with live Outline that jumps to anchors in the reader
- **AI features** (opt-in, see *AI backends* below) — chat with the doc, summary, Q&A, coach mode, knowledge-graph extraction
- **Persistence** — annotations stored in browser IndexedDB (scoped per Lab session in iframe mode); offline-ready
- **Theme-aware** — picks up Lab's light/dark/high-contrast variables automatically
- **Status bar** — shows reader state (ready / AI off / error) at a glance
- **`jupyter md-reader doctor` CLI** — diagnose your local AI runtime

## AI backends

Markdown Reader works with three AI backends. Pick what fits your privacy + hardware constraints.

| Backend     | Where it runs                 | Setup                                                            | Best for                              |
|-------------|-------------------------------|------------------------------------------------------------------|---------------------------------------|
| **WebLLM**  | In your browser (WebGPU)      | None — downloads ~2GB model on first use                         | Truly local, no install, no daemon    |
| **Ollama**  | On your machine, via daemon   | `ollama serve` + `ollama pull qwen2.5:7b` (see below)            | Fast, supports larger models, GPU     |
| **OpenRouter** | Cloud (Anthropic, OpenAI, etc.) | Paste an API key in settings                                  | Frontier models without local GPU     |

Default in the JL extension is **WebLLM** — zero install, no data leaves your browser. Switch backend in the reader's settings.

### Diagnose your setup

```bash
jupyter md-reader doctor
```

Prints a status table for Ollama (CLI on PATH, daemon reachable, recommended model present) and tells you exactly what to run if anything is missing. Pass `--ollama-url http://host:port` to probe a custom address.

### Ollama CORS

Browsers block cross-origin requests to `127.0.0.1:11434` by default. Either start Ollama with permissive origins:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

…or whitelist just your Lab origin:

```bash
OLLAMA_ORIGINS="http://localhost:8888" ollama serve
```

## Privacy & security

This release was built with privacy as a hard constraint.

- **Telemetry is compiled out of this build.** The Vite config for the JL iframe bundle (`vite.jupyter.config.ts`) replaces `posthog-js` with a no-op proxy and defines `MDR_TELEMETRY=0` at build time. The PostHog client is **not present** in the shipped wheel — it cannot be re-enabled by configuration.
- **No source maps shipped.** The build sets `sourcemap: false`; the wheel contains minified JS only.
- **Markdown content stays where you put it.** Local backends (WebLLM, Ollama) never send your document anywhere outside your machine. OpenRouter is the only backend that sends content to a remote service — and only when you explicitly enable it with an API key.
- **OpenRouter API keys live in browser localStorage.** That's standard for browser-resident keys, but treat them like passwords: don't commit them, rotate if exposed, and don't paste keys you can't revoke.
- **Iframe trust boundary.** The embedded SPA talks to the JL host over a versioned postMessage protocol with per-panel handshake nonce, origin pinning, and sequence-number replay protection. See `packages/jupyterlab/src/bridge/MessageBridge.ts` and `src/lib/iframe-bridge.ts` if you want to audit the wire protocol.
- **Dependency surface.** GitHub Dependabot opens auto-PRs for any security advisory in our shipped dep tree (npm + pip); a weekly CI audit (`.github/workflows/security-audit.yml`) cross-checks with OSV.dev and fails on high/critical. Transitive vulnerabilities are pinned to safe versions via the `overrides` block in the root `package.json`. JupyterLab's own dependencies (e.g. `sanitize-html` via `@jupyterlab/apputils`) are NOT bundled in the wheel — `@jupyterlab/builder` externalizes them and the user's installed JupyterLab provides them at runtime. Track JL framework CVEs at <https://github.com/jupyterlab/jupyterlab/security/advisories>. See `SECURITY.md` at the repo root for full disclosure policy.

If you find a security issue, please email the maintainer instead of filing a public issue.

## Settings

Open **Settings → Settings Editor → Markdown Reader** to configure:

- `ai.provider` — `webllm` / `ollama` / `openrouter` / `disabled`
- `ai.ollamaUrl` — daemon URL (default `http://localhost:11434`)
- `enabledFeatures` — toggle individual reader features
- `kernelBridge` — let the reader talk to the active Jupyter kernel (off → no kernel access)
- `companionPanel` — show/hide the Outline sidebar
- `telemetry` — accepted for API parity, but **has no effect in this build** (compiled out)

## Limitations

- **No notebook-cell rendering.** This extension does **not** register a `text/markdown` MIME renderer; that would hijack notebook markdown cells. The reader is opt-in per `.md` file.
- **Heavy AI features are lazy.** WebLLM, transformers, and Kokoro TTS download on first explicit use. They are not pre-fetched and are inert in air-gapped environments.
- **Annotations are local per browser.** Sidecar `.md.notes.json` persistence (so notes travel with the file) is planned for a future release.
- **Chat tab on the companion panel is a stub.** Use the chat inside the reader for now — it lives next to the document, has access to the kernel bridge, and supports all backends.

## Development

```bash
# From the repo root (not this directory):
npm ci
npm run build:jupyter       # build the iframe SPA into dist-jupyter/

# Then in packages/jupyterlab/:
pip install -e .
jupyter labextension develop --overwrite .

# Hot reload of TS sources while developing:
jlpm watch
jupyter lab
```

## License

MIT — see [`LICENSE`](LICENSE).
