# md-reader — Claude Code Instructions

## Task Management
- **Always add user requests to the todo list (TaskCreate) before starting work.** This ensures context is never lost, even across long conversations. Mark tasks as in_progress when starting and completed when done.

## Development

### Commands
- `npm run dev` — Vite dev server (port 5183)
- `npm run build` — TypeScript check + Vite build
- `npm run test` — Unit tests (vitest, 48 tests across 6 files)
- `npm run typecheck` — TypeScript check only (no emit)
- `npm run eval` — AI accuracy benchmark (Karpathy loop)
- `npm run lint` — ESLint

### Docker
- `./startup.sh` — Start app + Ollama via Docker Compose (port 5183)
- `./shutdown.sh` — Stop everything
- App container: `docker compose exec app <command>`

## Eval Loop (Karpathy Loop)
- Run `npm run eval` to measure accuracy (current best: **96/100**, 15/15 tests)
- Log results in `scripts/eval/results.tsv` after each experiment
- If score improves → keep changes. If equal/worse → revert
- Tested features: TOC (100), Stats (100), Summary (~87), Q&A (100), KG (90), Links (100), Coach (~75)
- Weakest: Coach explanation quality (~75/100) — next optimization target

## Key Paths
- **Prompts**: `src/lib/prompts.ts` (modify for accuracy improvements)
- **AI backend**: `src/lib/ai.ts` (Ollama/OpenRouter/WebLLM, streaming, temperature)
- **Eval runner**: `scripts/eval/runner.ts`
- **Ground truth**: `scripts/eval/ground-truth.json`
- **Test corpus**: `scripts/eval/test-corpus/`
- **Results log**: `scripts/eval/results.tsv`
- **UX backlog**: `docs/features/TODOS.md` (88 items shipped across 8 rounds)

## Architecture
- **Framework**: React 19 + Tailwind CSS 4 + Zustand
- **Markdown**: unified/remark ecosystem with GFM + math support
- **AI**: 3-backend system (OpenRouter cloud, Ollama local GPU, WebLLM browser)
- **Viz**: Markmap (mind maps), D3.js (treemap, graphs), Cytoscape.js
- **Storage**: IndexedDB via Dexie.js, localStorage for preferences
- **Search**: MiniSearch (BM25), TF-IDF cosine similarity

## Conventions
- Lazy-load heavy components (see App.tsx imports)
- All AI prompts in `src/lib/prompts.ts` — never hardcode in components
- Temperature 0.15 everywhere (proven by exp17)
- Chunk max size: 800 chars for RAG retrieval
- Use `window.confirm()` for destructive actions
- Toast notifications via DOM append with `.toast-notify` class
