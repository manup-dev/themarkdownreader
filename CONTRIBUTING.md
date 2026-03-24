# Contributing to md-reader

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/manup-dev/themarkdownreader.git
cd md-reader
npm install
npm run dev
```

Open http://localhost:5183 — upload any `.md` file to see it in action.

## Development Commands

```bash
npm run dev          # Vite dev server (port 5183)
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run test         # Unit tests (vitest)
npm run eval         # AI accuracy benchmark
npm run build        # Production build
```

## Making Changes

1. **Open an issue first** to discuss what you'd like to change
2. Fork the repo and create a branch from `main`
3. Make your changes
4. Ensure all checks pass: `npm run typecheck && npm run lint && npm run test`
5. If you modified AI prompts (`src/lib/prompts.ts`), run `npm run eval` — score must not regress
6. Submit a pull request

## Code Conventions

- All AI prompts live in `src/lib/prompts.ts` — never hardcode in components
- Temperature 0.15 everywhere for AI calls
- Lazy-load heavy components (see `App.tsx` imports)
- Use `window.confirm()` for destructive actions
- Toast notifications via DOM append with `.toast-notify` class

## Eval System

md-reader uses a Karpathy-style eval loop to measure AI accuracy:

```bash
npm run eval  # Runs 15 tests, reports score out of 100
```

If you change prompts or AI logic, the eval score must stay at or above the current baseline. Log your results in `scripts/eval/results.tsv`.

## Project Structure

- `src/components/` — React components
- `src/lib/` — Core logic (AI, markdown parsing, storage, TTS)
- `src/store/` — Zustand state management
- `scripts/eval/` — AI accuracy benchmark system
