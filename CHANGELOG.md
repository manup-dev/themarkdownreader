# Changelog

All notable changes to md-reader are documented here.

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
