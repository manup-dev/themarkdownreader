# md-reader Browser Extension

Read GitHub markdown files beautifully with mind maps, AI chat, TTS, and visual exploration.

## Install

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked" and select this `browser-extension/` folder

## Usage

- Navigate to any `.md` file on GitHub
- Click the **"Open in md-reader"** button in the file toolbar
- Or click the extension popup and press "Open Current File"

## Features

When you open a markdown file in md-reader, you get:
- Beautiful reading view with 4 themes
- Interactive mind map of document structure
- AI-powered Q&A and summarization
- Text-to-speech with smart narration
- Comments and highlights
- Section-by-section visual coach

## Configuration

Click the extension icon to set a custom md-reader URL (e.g., `http://localhost:5183` for local development).

## How It Works

The extension detects when you're viewing a `.md` file on GitHub and:
1. Adds an "Open in md-reader" button to the file toolbar
2. Fetches the raw markdown content
3. Opens md-reader and sends the content via `postMessage`

If postMessage delivery fails, it falls back to opening md-reader with the raw URL as a hash parameter.
