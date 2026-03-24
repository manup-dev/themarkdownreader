# md-reader Roadmap

## v0.1.0 — "The Beautiful Markdown Reader" (Ship First)

Core features that work without AI, no Docker required:

- [x] Upload / paste / URL / write markdown input
- [x] Beautiful reader with 3 themes (light, dark, sepia)
- [x] Auto-generated TOC + reading progress tracking
- [x] Interactive mind map (markmap)
- [x] Treemap visualization (D3)
- [x] Teacher-like TTS read-aloud (Web Speech API)
- [x] Text selection → highlight, AI explain, define, search, copy, copy-as-quote, copy-with-source
- [x] Resizable sidebar + chat panels (drag handles)
- [x] Editable filename + Save to library
- [x] Summary Cards (non-AI: first paragraph fallback)
- [x] Error boundaries on all views with retry
- [x] Keyboard shortcuts (j/k sections, Ctrl+1-4 views, Esc close, ? help overlay, f focus mode)
- [x] Code block syntax highlighting colors per theme (light/dark/sepia)
- [x] Deploy configs: vercel.json + netlify.toml
- [x] Lazy loading / code splitting for heavy views (MindMap, Treemap, Chat, Coach, Graph, Workspace)
- [x] Auto-detect system dark mode on first visit
- [x] Ctrl+V paste-to-open on upload screen
- [x] First-visit onboarding hint ("Drop a file, paste with Ctrl+V, or click to browse")
- [x] Back to top button (appears after 15% scroll)
- [x] Progress milestones (bounce animation at 25/50/75%, green "Done!" at 100%)
- [x] Copy confirmation (icon → green checkmark for 1.2s)
- [x] TOC auto-scrolls to active section
- [x] Section reading time in TOC ("2m" next to each H1/H2)
- [x] TTS speed presets (0.75x, 1x, 1.25x, 1.5x, 2x buttons) + time remaining estimate
- [x] Focus mode (press f/F11 — hides all chrome, Esc to exit)
- [x] View transition animations (150ms fade between tabs)
- [x] Reading position persistence (resume from where you left off per document)
- [x] Document difficulty badge (Beginner/Intermediate/Advanced/Expert)
- [x] Mind map download as PNG (2x resolution)
- [x] Mind map fit-to-view button
- [x] Export highlights as markdown (quote blocks with notes)
- [x] Reading streak counter on upload screen ("X documents read")
- [x] Theme/font size/panel width persistence to localStorage
- [x] Responsive mobile layout (CSS media queries for < 768px)
- [x] Print-friendly stylesheet
- [x] PWA manifest.json + meta tags
- [x] Image click-to-zoom lightbox
- [x] README.md with full feature docs + quick start
- [x] GitHub Actions CI/CD (build, test, VS Code extension packaging)

## v0.2.0 — "AI-Powered Understanding"

AI features via cloud API (free tier) OR local Ollama:

- [x] Chat Q&A with streaming + markdown rendering in responses
- [x] Coach mode (explain sections with analogies, comprehension quiz)
- [x] Knowledge Graph (AI concept extraction → D3 force-directed)
- [x] Summary Cards with AI summaries
- [x] OpenRouter cloud API (free models, no Docker needed)
- [x] AI Settings modal (API key input, Ollama URL, backend detection, test connection)
- [x] Ollama Docker setup with GPU (auto model pull + VRAM warmup)
- [x] WebLLM fallback when WebGPU available
- [x] 3-backend auto-detection: OpenRouter → Ollama → WebLLM → helpful error
- [x] Streaming with onToken callback for all backends

## v0.3.0 — "Document Library"

Multi-doc workspace with cross-document intelligence:

- [x] IndexedDB document store (Dexie.js, compound indexes, batch writes)
- [x] MiniSearch BM25 full-text search with serialized index persistence
- [x] TF-IDF cosine similarity between documents
- [x] SimHash near-duplicate detection (32-bit, Hamming distance ≤ 3)
- [x] SHA-256 exact duplicate detection
- [x] Hierarchical 3-tier search (doc → section → chunk funnel)
- [x] Cross-document Q&A with hierarchical RAG
- [x] Document relationship graph (D3 force-directed, edge labels)
- [x] Correlation view with AI explanations
- [x] Highlights / annotations persisted in IndexedDB
- [x] navigator.storage.persist() for data durability
- [x] Export/import library as JSON backup
- [ ] UMAP similarity map (needs testing with real multi-doc data)
- [ ] Louvain community detection (needs testing)

## v0.4.0 — "VS Code Extension"

Bring md-reader into VS Code as a webview extension:

- [x] Extension host: read active .md file, watch for changes, debounced updates
- [x] Webview: reuses Reader, MindMap, Treemap, TTS, Summary Cards from main app
- [x] vscode.postMessage bridge for file content + config
- [x] Extension packaged as .vsix, installed in VS Code
- [x] Commands: Open Reading View, Open Mind Map, Read Aloud
- [x] Status bar button (visible when .md file active)
- [x] Keybinding: Ctrl+Shift+R to open reader
- [x] Theme auto-sync with VS Code (light/dark)
- [x] Settings: ollamaUrl, theme, fontSize, defaultView
- [x] Fallback inline HTML renderer (works without webview build)
- [ ] Publish to VS Code Marketplace
- [ ] Editor title bar icon refinement

## Delight Items Implemented (20 total)

1. [x] Copy confirmation toast (green checkmark)
2. [x] Back to top button (after 15% scroll)
3. [x] Keyboard shortcut overlay (press ?)
4. [x] Progress milestones (25/50/75/100% bounce)
5. [x] Auto-detect system dark mode
6. [x] Ctrl+V paste-to-open on upload
7. [x] TTS time remaining estimate
8. [x] Double-click word selection (works natively)
9. [x] Remember scroll position per document
10. [x] Animated view transitions (150ms fade)
11. [x] Copy as... (plain, quote block, with source)
12. [x] Focus mode (f/F11, hide all chrome)
13. [x] First-visit drag hint
14. [x] Section reading time in TOC
15. [x] TOC auto-scrolls to active section
16. [x] Reading streak counter
17. [x] Document difficulty badge
18. [x] Mind map download as PNG
19. [x] Export highlights as markdown
20. [x] Mind map fit-to-view button
21. [x] Image lightbox (click image → zoom overlay, click to dismiss)
22. [x] Code block copy button (hover → "Copy" button top-right)
23. [x] Reading streak counter increments on document load
24. [x] Click heading to copy anchor link (# appears on hover, copies URL)
25. [x] Minibar outline on right edge (heading position markers)
26. [x] Knowledge graph: click concept → switch to reader + highlight mentions
27. [x] In-document search (Ctrl+K or /) with match count and navigation
28. [x] Print-friendly stylesheet
29. [x] Mobile responsive CSS (@media < 768px)

## Future (Post-Launch)

### Reading Experience
- [x] Responsive mobile layout (CSS media queries)
- [x] Inline image zoom on click (lightbox)
- [x] Print-friendly stylesheet
- [x] In-document search (Ctrl+K or /)
- [x] Dyslexia-friendly font toggle (wider spacing, Comic Sans/Trebuchet fallback)
- [x] High contrast theme (black bg, yellow headings, cyan links, green code)

### AI Enhancements
- [ ] Web Worker for AI inference (off main thread)
- [ ] transformers.js semantic embeddings (replace keyword TF-IDF)
- [ ] Audio Overview (NotebookLM-style podcast generation)
- [ ] Sunburst diagram for document structure
- [ ] Timeline view for temporal content (auto-detect dates)
- [ ] Flowchart view for procedural docs (LLM extracts steps)
- [ ] Entity resolution across documents (embedding similarity > 0.85)
- [ ] MinHash + LSH for section-level overlap detection

### Visualization
- [x] Knowledge graph: click concept → switch to reader + highlight mentions
- [ ] Semantic zoom in mind map (show more detail as you zoom)
- [ ] Coordinated highlighting (hover in any viz → scroll to text)
- [ ] Treemap: breadcrumb trail when zoomed into section

### Infrastructure
- [x] CI/CD (GitHub Actions: build, test, VS Code extension packaging)
- [x] PWA manifest.json + meta tags
- [x] PWA service worker (offline cache-first for assets, network-first for HTML)
- [ ] Browser extension (render GitHub markdown beautifully with md-reader)
- [ ] Monorepo refactor (packages/core, packages/web, packages/vscode)
- [ ] Production build optimization (tree-shaking WebLLM when not used)
- [ ] E2E tests with Playwright

### Monetization (When Ready)
- [ ] Supabase pgvector for premium cloud sync
- [ ] Cloudflare Vectorize + D1 for scale tier
- [ ] Stripe/LemonSqueezy payment integration ($5-8/mo Pro)
- [ ] "Powered by md-reader" badge on free-tier shared documents
- [ ] Template/plugin marketplace (community themes, viz templates)
- [ ] Rendering API as a service (metered, $0.005/render)
- [ ] White-label licensing for enterprises

### Community & Launch
- [x] GitHub README with full feature docs, quick start, tech stack
- [ ] Product Hunt launch (Tuesday, 12:01 AM PT, 4-6 week prep)
- [ ] Show HN post
- [ ] Discord server
- [ ] GitHub Sponsors + Buy Me a Coffee
- [ ] "State of Markdown" annual report (thought leadership)
- [ ] Dev blog (architecture decisions, performance posts)
