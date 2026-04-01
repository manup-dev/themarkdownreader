export const SAMPLE_MARKDOWN = `# Welcome to md-reader

> The AI-native markdown reader. Read, understand, and explore your documents.

## What You Can Do

md-reader transforms how you consume markdown. Here's what's at your fingertips:

- **Ask AI anything** — Chat with your document, get instant answers
- **Generate Mind Maps** — Visualize document structure in one click
- **Listen with TTS** — Smart text-to-speech that skips syntax characters
- **Get Summaries** — AI-generated summary cards for quick comprehension
- **Explore Visually** — Knowledge graphs, treemaps, and more
- **Quiz Yourself** — AI Coach generates questions to test understanding

## How AI Works

md-reader supports **three AI backends**, auto-detected based on your setup:

1. **Ollama (Local GPU)** — Best quality, runs on your machine with full privacy
2. **WebLLM (In-Browser)** — No install needed, runs entirely in your browser tab
3. **OpenRouter (Cloud)** — Access powerful models via API key

No configuration required — md-reader detects what's available and picks the best option.

## Features at a Glance

| Feature | What It Does |
|---------|-------------|
| Reader Mode | Kindle-like, distraction-free reading |
| Table of Contents | Auto-generated, click to navigate |
| AI Chat | Ask questions, get cited answers |
| Mind Map | Interactive visual overview |
| Knowledge Graph | Entity relationships from your doc |
| Summary Cards | Key points extracted by AI |
| AI Coach | Quizzes and explanations for learning |
| TTS Read-Aloud | Natural narration, skip code blocks |
| Multi-Doc Workspace | Compare and cross-reference files |
| Reading Progress | Track where you left off |

## Try It Now

Here are some things to try right now:

1. **Open the chat** — Click the blue chat bubble (bottom-right) and ask a question
2. **Switch views** — Use the toolbar to try Mind Map or Knowledge Graph
3. **Listen** — Hit the TTS button to hear this document read aloud
4. **Explore the TOC** — The sidebar shows document structure

## Technical Details

Built with a modern stack designed for performance and privacy:

\`\`\`typescript
const stack = {
  frontend: 'React 19 + Tailwind CSS 4',
  markdown: 'unified / remark with GFM + math',
  ai: 'Ollama + WebLLM + OpenRouter',
  visualization: 'Markmap + D3.js + Cytoscape.js',
  tts: 'Web Speech API + Piper WASM',
  storage: 'IndexedDB via Dexie.js',
  search: 'MiniSearch (BM25) + TF-IDF',
}
\`\`\`

### Privacy First

- **No server** — Everything runs in your browser
- **No tracking** — Zero analytics by default
- **No uploads** — Your files never leave your device
- **Open source** — Inspect every line of code

---

*Drop your own markdown file to get started, or explore this sample using the tools above.*
`
