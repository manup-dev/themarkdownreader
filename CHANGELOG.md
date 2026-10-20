# Changelog

All notable changes to md-reader are documented here.

## 2026-10-20 — Open Folder fix, CI + security audit fixes

- **Open Folder works in Firefox, Safari and Brave.** Browsers without `showDirectoryPicker` dead-ended on an empty "No folder open" screen (Upload page), silently did nothing (Mode menu), or hid the button (Library). `openDirectory()` now falls back to an `<input webkitdirectory>` picker. Handle-less folders keep their real name, so opening a second folder gets its own tab instead of re-focusing the first, and per-folder progress/expand state stays scoped correctly.

- **Node ≥ 22.12 required** (`engines`, `.nvmrc`). jsdom and postcss now `require()` ES modules, which only works on Node 22.12+; on Node 20 `npm test` and `npm run build` crash with `ERR_REQUIRE_ESM`. The `security-audit` workflow was still on Node 20 and is moved to 22 to match the rest of CI.
- **Security audit gate green**: production tree goes from 23 high → 0 high/critical via `overrides` (nanoid, postcss, fast-uri, sharp, adm-zip, tar, immutable, dompurify, markdown-it, sanitize-html; sass pinned past the `braces` chain; cheerio's nested undici; JupyterLab filebrowser's stray jest-environment-jsdom → 30). katex (moderate) is left at 0.16 — its fix is a 0.x minor that may change math rendering.
- `tsconfig.node.json` now declares the `DOM` lib explicitly; `scripts/eval` reaches browser modules and previously only type-checked because a hoisted `@types/jsdom` leaked DOM types in.
- `claude-code-plugin/hook.mjs` regenerated (bundles the patched markdown-it).

## 2026-07-16 — Launch readiness

First coordinated release across all surfaces: npm CLI (`npx md-reader`), MCP server (`md-reader-mcp`), VS Code extension, browser extension, and Claude Code plugin — all at 1.0.0. Repo hygiene pass: private root package, portable e2e fixtures, no machine-specific paths.

## [1.0.0] — 2026-04-01

### First Stable Release

md-reader is the AI-native markdown reader — built for reading, not writing.

#### Core Reading Experience
- 4 themes: Light, Dark, Sepia, High Contrast (WCAG AAA)
- Auto-generated Table of Contents with section reading times
- Bionic reading mode, word heatmap, TL;DR mode
- Focus mode and Zen mode for distraction-free reading
- Print/PDF export with clean formatting

#### AI-Powered Understanding
- 3-backend AI: OpenRouter (cloud), Ollama (local GPU), WebLLM (browser)
- Streaming chat Q&A with section references
- AI Coach with visual explanations and quizzes
- Text selection menu: explain, simplify, ELI5, diagram, cite
- AI-generated section summaries

#### Visual Exploration
- Interactive mind maps with depth control and PNG export
- D3.js treemap visualization of document structure
- Knowledge graph with concept extraction and force-directed layout
- Summary cards with expandable overviews

#### Multi-Document Library
- Document workspace with BM25 search
- Cross-document Q&A and relationship discovery
- Document similarity clustering (Louvain + UMAP)
- Collection reader with linked reading order

#### Text-to-Speech
- Teacher-like narration with smart prosody
- Heading announcements, code block handling, list pacing
- Speed presets and section navigation

#### Comments and Annotations
- Inline comments with 5-color highlights
- Auto-generated glossary from highlights
- Export highlights and comments

#### Power User Features
- 80+ keyboard shortcuts with Vim navigation
- Command palette (Ctrl+K) with cross-document search
- Reading streak tracking and progress persistence

#### Distribution
- Web app (hosted on GitHub Pages)
- VS Code extension with CodeLens, outline, and sync scroll
- GitHub browser extension for one-click reading
- MCP server for Claude Code integration
- CLI: `npx md-reader` with Ollama auto-detection

#### Developer Experience
- Eval system (Karpathy loop) for AI prompt quality — 96/100 accuracy
- 48+ unit tests, CI/CD via GitHub Actions
- Docker setup with GPU-accelerated Ollama
