<div align="center">

# md-reader

# Read it. → Ship it.

**Comprehend. Then act. Without the alt-tab.**
*Understand any spec as a podcast or mind map, then highlight a passage and ship a grounded prompt to Claude Code with line refs. Local, offline, MIT.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/manup-dev/themarkdownreader/actions/workflows/ci.yml/badge.svg)](https://github.com/manup-dev/themarkdownreader/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](CHANGELOG.md)

**[▶ Try Live Demo](https://manup-dev.github.io/themarkdownreader/?demo=true)** · **[Install CLI](#install)** · **[VS Code Extension](#vs-code-extension)**

</div>

<div align="center">
  <img src="public/og-card.png" alt="md-reader — Read it. Ship it." width="800" />
</div>

---

## Why md-reader?

**Comprehension and action are two distinct problems, and no tool handles both.** NotebookLM helps you understand a doc but leaves you stranded when it's time to act. Claude Code, Codex, and Cursor happily implement anything you paste, but assume you already understood it. So you read in one tab, alt-tab, retype context, lose line references, and pray.

md-reader closes that gap. One app, both halves:

### 📖 Read it. — understand any doc in minutes

- 🎙️ **Two AI voices discussing it** — like NotebookLM, but on your GPU
- 🧠 **Auto-generated mind map** — structural overview in one click
- 🎓 **AI tutor** — explains sections, quizzes your comprehension
- 💬 **Chat with the doc** — grounded answers with section citations
- 🔊 **Neural TTS** — Kokoro-82M WebGPU narration
- 📊 **Knowledge graph + treemap** — visualize concept relationships

### 🚀 Ship it. — hand off to your coding agent

- ✨ **Select a paragraph** in any spec, RFC, or design doc
- 💭 **Comment** what you want changed, reviewed, or implemented
- 🎯 **Generate** a Claude Code / Codex / generic prompt with exact `file:line` references
- ⚡ **One-click ship** to a VS Code terminal running `claude`, or to your clipboard for claude.ai

The VS Code extension makes this a single keyboard shortcut. The Chrome extension lets you do it on any `.md` file on GitHub without cloning the repo. Local AI means your proprietary specs never leave your machine.

All of it runs on your machine. No API keys. No signup. No rate limits. No data leaving your device.

```bash
npx md-reader README.md
```

### What you'll actually save

md-reader closes three loops end-to-end, each with a dollar sign or an hour count attached:

| Role | The loop | Replaces | You save |
|---|---|---|---|
| **PMs & staff engineers** | 30-page PRD → 2-min podcast on the walk to standup → walk in knowing the debate | Skimming while pretending to listen | ~37 hours/year per PM |
| **Consultants & freelancers** | 200-page client data room → overnight batch: `for f in data-room/*.md; do npx md-reader "$f"; done` → podcast + mind map + tutor quiz per doc | 8 hours of unpaid client prep | ~$1,600 per engagement @ $200/hr |
| **Everyone paying for AI** | One local tool replaces ChatGPT Plus + Notion AI + Readwise Reader + Reflect | $55/mo in SaaS subscriptions | $660/year, forever |

### How is this different from NotebookLM, Obsidian, and the rest?

| | md-reader | NotebookLM | Obsidian | Typora | VS Code Preview |
|---|---|---|---|---|---|
| **Ship prompts to Claude Code / Codex** | ✅ One click, with line refs | ❌ | ❌ | ❌ | ❌ |
| **Podcast generation** | ✅ Local, offline | ✅ Google cloud | ❌ | ❌ | ❌ |
| **Mind maps** | ✅ Auto-generated | ❌ | ❌ Plugin required | ❌ | ❌ |
| **AI tutor / coach** | ✅ Built-in | ⚠️ Chat only | ❌ Plugin required | ❌ | ❌ |
| **Knowledge graph** | ✅ AI-extracted | ❌ | ⚠️ Link-based only | ❌ | ❌ |
| **TTS** | ✅ Kokoro-82M local | ❌ | ❌ | ❌ | ❌ |
| **Local AI** | ✅ Ollama + WebLLM | ❌ Cloud-only | ❌ | ❌ | ❌ |
| **Works offline** | ✅ Airplane-ready | ❌ | ✅ (no AI) | ✅ | ✅ |
| **Rate limits** | ✅ None | ❌ Google quotas | ✅ | ✅ | ✅ |
| **No account** | ✅ | ❌ Google login | ✅ | ⚠️ License | ✅ |
| **Open source** | ✅ MIT | ❌ | ❌ | ❌ | ✅ |
| **Browser-based** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Price** | Free forever | Freemium (quotas) | Freemium | $15 | Free |

---

## Install

### Quick start (no install)

```bash
npx md-reader README.md
```

### Global install

```bash
npm install -g md-reader
md-reader my-doc.md
```

### Pipe from stdin

```bash
cat README.md | md-reader
gh repo view --json body -q .body | md-reader
```

### Web app

Visit the **[live demo](https://manup-dev.github.io/themarkdownreader/?demo=true)** — no install needed.

### Docker (with local AI)

```bash
git clone https://github.com/manup-dev/themarkdownreader.git
cd themarkdownreader
./startup.sh  # Starts app + Ollama with GPU
```

---

## Features

### Reading Experience
- **Beautiful reader** with 4 themes (light, dark, sepia, high-contrast WCAG AAA)
- **Auto-generated TOC** with section reading times, bookmarks, and active section tracking
- **Segmented progress bar** showing reading position per section
- **Focus mode** (`f`) and **Zen mode** (`Z`) for distraction-free reading
- **Resume reading** — automatically picks up where you left off
- **Difficulty badge** — Beginner/Intermediate/Advanced/Expert per document
- **Live WPM counter** — see your reading speed in real-time
- **Estimated finish time** — "~3 min left (2:45 PM)"
- **Confetti celebration** when you finish reading a document
- **Reading streak** — tracks consecutive days of reading
- **Dyslexia-friendly font** toggle for accessible reading

### Visual Exploration

<div align="center">
  <img src="docs/screenshots/hero-mindmap.png" alt="md-reader mind map" width="800" />
  <p><em>Auto-generated interactive mind maps</em></p>
</div>

- **Interactive mind map** from heading hierarchy (download as PNG, Ctrl+click to navigate)
- **Treemap** showing relative section sizes with dynamic text contrast
- **Knowledge graph** — AI-extracted concepts with deterministic fallback
- **Summary cards** — expandable section overview with AI summaries

### AI-Powered Understanding

![Chat panel](docs/screenshots/chat.png)

- **Chat Q&A** — ask questions with streamed markdown responses + follow-up suggestions
- **Chat export** — download entire Q&A session as markdown
- **Visual coach** — AI explains sections with analogies, comprehension quizzes with mastery tracking
- **Selection menu** — select text to explain, simplify (ELI5), visualize as diagram, define, cite, highlight, copy
- **"Jump to section" badges** — AI responses link to mentioned document sections
- **3 AI backends**: OpenRouter (cloud, free), Ollama (local GPU), WebLLM (browser)
- **AI status indicator** — colored dot shows which backend is active

### Text-to-Speech
- **Teacher-like narration** — announces headings, describes code blocks, reads lists naturally
- **Speed presets** (0.75x-2x) with WPM tooltips and time remaining
- **Section title display** — see which section is being read aloud

### Multi-Document Library
- **Upload multiple files** — indexed with BM25 full-text search
- **Cross-document Q&A** — ask questions across all your documents
- **Document graph** — visualize relationships between documents
- **Correlation view** — find shared terms between documents
- **Similarity map** — cluster documents by topic (Louvain + UMAP)
- **Collection reader** — connected reading with link discovery and reading order
- **Reading queue** — bookmark docs for later with total time estimates
- **Sort & filter** — by name, size, or date with preview tooltips
- **Duplicate detection** — SimHash fingerprinting catches near-duplicates
- **Export/import** library as JSON backup

### Comments & Annotations
- **Inline comments** — select text, add comments with author names
- **Comments panel** — view, resolve, export, and jump to all comments
- **5-color highlights** with notes and export as markdown
- **Glossary** — auto-detect and define terms from your highlights

### Power User Features
- **Command palette** (`Ctrl+K`) — switch views, toggle theme, print, all in one
- **Vim navigation** — `j`/`k` sections, `gg` top, `G` bottom
- **Bionic reading** (`b`) — bold first half of words for faster scanning
- **Word heatmap** (`h`) — visualize word frequency with color intensity
- **TL;DR mode** (`d`) — collapse to headings only, click to expand
- **Quick glance** (hold `Space`) — preview next section without scrolling
- **Print/PDF export** — `p` key or toolbar button with clean print stylesheet
- **Section difficulty badges** — green/amber/red dots in TOC showing content density
- **Reading speed calibration** — personalized time estimates based on your WPM
- **Code blocks** — language labels, syntax highlighting, one-click copy
- **VS Code extension** — read markdown inside your editor with CodeLens, Outline, sync scroll
- **GitHub extension** — one-click "Open in md-reader" on any GitHub `.md` file

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous section |
| `f` | Toggle focus mode |
| `Z` | Toggle zen mode (ultra-minimal) |
| `p` | Print / Export PDF |
| `t` | Cycle theme |
| `?` | Show all keyboard shortcuts |
| `gg` | Jump to top (double-tap g) |
| `G` | Jump to bottom (Shift+G) |
| `Ctrl+K` | Command palette / search |
| `Ctrl+1-4` | Switch view (Read / Mind Map / Cards / Treemap) |
| `Ctrl+Shift+F` | Toggle focus mode |
| `1-4` | Select quiz answer in Coach mode |
| `Esc` | Close panel / exit mode |
| `b` | Bionic reading (bold first half of words) |
| `h` | Word frequency heatmap |
| `d` | TL;DR mode (headings only) |
| `s` | Auto-scroll |
| `Space` (hold) | Quick glance at next section |
| `Ctrl+V` | Paste markdown to open (on upload screen) |

## Quick Start

```bash
git clone https://github.com/manup-dev/themarkdownreader.git
cd md-reader
```

### Option A: With local AI (recommended — Docker + GPU)

If you have Docker and an NVIDIA GPU:

```bash
./startup.sh
```

This starts both the app and Ollama with GPU acceleration. Open http://localhost:5183 — AI features work immediately.

> Ollama auto-pulls `qwen2.5:1.5b` (~1GB). The app is at port 5183, Ollama at 11435.

### Option B: Without Docker (cloud AI)

```bash
npm install
npm run dev
```

Open http://localhost:5183, then configure an AI backend:

1. Click the **gear icon** (top-right) to open AI Settings
2. Get a free API key from [OpenRouter](https://openrouter.ai/keys)
3. Paste it and click **Test** to verify

![AI Settings — paste your OpenRouter key here](docs/screenshots/ai-settings.png)

> Without an AI key, the reader, mind maps, treemap, and TTS still work — only Chat, Coach, and Knowledge Graph need AI.

### VS Code Extension

Use md-reader directly inside VS Code — open any `.md` file and read it with mind maps, TTS, and all visualizations.

```bash
cd vscode-extension
npm install
npm run build
```
Then in VS Code: `Ctrl+Shift+P` → **"Install from VSIX"** → select `vscode-extension/md-reader-0.1.0.vsix`

Or install from source:
```bash
cd vscode-extension && npx @vscode/vsce package --no-dependencies
code --install-extension md-reader-0.1.0.vsix
```

**Usage:** Open any `.md` file → press `Ctrl+Shift+R` (or click the book icon in the editor title bar)

**VS Code features:**
- Reading time CodeLens on headings
- Outline view with section word counts
- Hover preview for markdown links
- Sync scroll between editor and reader
- Session summary on close
- Status bar reading progress

### GitHub Browser Extension

Read any markdown file on GitHub with the full md-reader experience — mind maps, AI chat, highlights, and more.

```bash
# Chrome / Edge / Brave
1. Open chrome://extensions (or edge://extensions)
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the browser-extension/ folder from this repo
```

**Usage:** Navigate to any `.md` file on GitHub → click **"Open in md-reader"** in the file toolbar.

By default it opens the hosted version. To use your local dev server instead, click the extension icon and set the URL to `http://localhost:5183`.

### Development

```bash
npm run dev          # Vite dev server (port 5183)
npm run test         # Unit tests (vitest)
npm run eval         # AI accuracy benchmark (15 tests, ~95/100)
npm run typecheck    # TypeScript check
npm run build        # Production build
npm run lint         # ESLint
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Tailwind CSS 4 |
| Markdown | unified / remark ecosystem (GFM + math) |
| Visualization | Markmap, D3.js, Cytoscape.js |
| AI (cloud) | OpenRouter (free models) |
| AI (local) | Ollama + qwen2.5:1.5b (GPU) |
| AI (browser) | WebLLM (WebGPU) |
| Search | MiniSearch (BM25), TF-IDF cosine similarity |
| Storage | IndexedDB via Dexie.js |
| TTS | Web Speech API |
| State | Zustand (with devtools) |

## Project Structure

```
src/
├── components/            # React components
│   ├── Reader.tsx         # Reading view (4 themes, WPM, progress, footnotes)
│   ├── MindMap.tsx        # Interactive mind map (depth control, sync highlight)
│   ├── TreemapView.tsx    # D3 treemap with dynamic contrast
│   ├── Chat.tsx           # AI Q&A (streaming, follow-ups, section badges)
│   ├── Coach.tsx          # Visual coach + quiz + mastery tracking
│   ├── CommentsPanel.tsx  # Document annotations & comments
│   ├── KnowledgeGraph.tsx # AI concept graph + deterministic fallback
│   ├── SummaryCards.tsx   # Expandable section cards
│   ├── TtsPlayer.tsx      # Teacher-like TTS with section titles
│   ├── SelectionMenu.tsx  # Text selection (ELI5, cite, highlight, comment)
│   ├── SearchOverlay.tsx  # Search + command palette (Ctrl+K)
│   ├── Workspace.tsx      # Multi-doc library (sort, queue, graph)
│   └── ...
├── lib/
│   ├── ai.ts              # 3-backend AI (OpenRouter/Ollama/WebLLM, streaming)
│   ├── prompts.ts         # AI prompt templates (optimized for 1.5B models)
│   ├── markdown.ts        # Parsing, chunking (800-char cap), TOC, stats
│   ├── docstore.ts        # IndexedDB with SimHash, TF-IDF, BM25, comments
│   ├── telemetry.ts       # Optional anonymous usage analytics (opt-in)
│   └── ...
├── store/useStore.ts      # Zustand state (devtools in dev mode)
└── test/                  # Vitest unit tests

vscode-extension/          # VS Code extension
├── src/extension.ts       # Commands, CodeLens, Outline, hover, sync scroll
├── src/ReaderPanel.ts     # Webview panel management
└── webview/               # React webview (shares main app components)

browser-extension/         # Chrome/Edge extension for GitHub
├── manifest.json          # Manifest V3
├── content.js             # Injects "Open in md-reader" on GitHub .md files
└── popup.html             # Extension popup with settings

scripts/eval/              # AI accuracy benchmark system
├── runner.ts              # Eval harness (15 tests, 96/100 avg)
├── ground-truth.json      # Expected outputs
├── test-corpus/           # 5 test markdown files
└── results.tsv            # Experiment log
```

## Eval System (Karpathy Loop)

md-reader uses a systematic eval loop for AI quality:

```bash
npm run eval  # Runs 15 tests, reports score out of 100
```

| Feature | Tests | Best Score |
|---------|-------|-----------|
| TOC extraction | 2 | 100/100 |
| Document stats | 2 | 100/100 |
| AI summarization | 2 | ~87/100 |
| AI Q&A | 2 | 100/100 |
| Knowledge graph | 1 | 90/100 |
| Collection links | 1 | 100/100 |
| Cross-doc Q&A | 1 | 100/100 |
| Mind map structure | 2 | 100/100 |
| TTS narration | 1 | 100/100 |
| Coach explanation | 1 | ~80/100 |

## Claude Code Integration (MCP)

md-reader can serve as a visual companion for Claude Code. Claude reasons about your docs; md-reader visualizes them.

### Setup

1. Start the dev server: `npm run dev`
2. Install MCP server dependencies: `cd mcp-server && npm install`
3. Add to your Claude Code MCP config (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "md-reader": {
      "command": "npx",
      "args": ["tsx", "mcp-server/index.ts"],
      "cwd": "/path/to/md-reader"
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `show_mind_map` | Interactive mind map of a markdown file |
| `show_knowledge_graph` | Force-directed concept network |
| `show_treemap` | Section-size proportional treemap |
| `read_aloud` | Text-to-speech narration |
| `show_coach` | AI coach with explanations + quizzes |

### Example

Ask Claude: *"Show me a mind map of docs/architecture.md"* — Claude invokes the tool and your browser opens the interactive visualization.

## License

MIT

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

---

*Built with 220+ features across 11 rounds of systematic polish. Available as a web app, VS Code extension, and GitHub browser extension.*
