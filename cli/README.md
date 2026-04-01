# md-reader

AI-native markdown reader. One command, local AI, no API keys.

## Quick Start

```bash
# Run instantly with npx
npx md-reader README.md

# Or install globally
npm install -g md-reader
md-reader README.md
```

## Usage

```bash
# Open a markdown file
md-reader document.md

# Pipe from stdin
cat notes.md | md-reader
gh issue view 42 --json body -q .body | md-reader

# Open empty (use drag & drop)
md-reader

# Custom port
md-reader --port 8080 file.md

# Don't auto-open browser
md-reader --no-open file.md
```

## AI Backends

md-reader auto-detects available AI backends:

1. **Ollama** (local GPU) -- auto-detected if running at `localhost:11434`
2. **WebLLM** (in-browser) -- runs via WebGPU, zero setup
3. **OpenRouter** (cloud) -- paste your API key in settings

No configuration needed. If Ollama is running, it's used automatically. Otherwise, WebLLM runs models directly in your browser.

## Features

- Mind maps, knowledge graphs, and treemaps
- AI-powered Q&A, summaries, and coaching
- Text-to-speech with reading progress
- Full-text search across documents
- Dark mode, reading stats, glossary
- Works 100% offline with local AI

## Options

| Flag | Description |
|---|---|
| `-p, --port <n>` | Port to serve on (default: 4173) |
| `--no-open` | Don't auto-open the browser |
| `-h, --help` | Show help |

## Links

- [Live Demo](https://manup-dev.github.io/themarkdownreader/)
- [GitHub](https://github.com/manup-dev/themarkdownreader)
- [Report Issues](https://github.com/manup-dev/themarkdownreader/issues)

## License

MIT
