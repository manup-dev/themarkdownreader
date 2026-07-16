# Harness Overview

A representative architecture doc used by the e2e suite to verify mermaid rendering.

## Request flow

```mermaid
flowchart TB
  U[User] --> CLI[md-reader CLI]
  CLI --> S[sirv static server]
  S --> B[Browser app]
  B --> O{Ollama up?}
  O -- yes --> L[Local LLM]
  O -- no --> W[WebLLM fallback]
```

## Handshake

```mermaid
sequenceDiagram
  participant CLI
  participant Browser
  participant Ollama
  CLI->>Browser: open ?cli=true
  Browser->>Ollama: GET /api/tags
  Ollama-->>Browser: model list
  Browser->>Browser: enable local AI
```

## Reader states

```mermaid
stateDiagram-v2
  [*] --> Empty
  Empty --> Reading: file loaded
  Reading --> MindMap: tab switch
  MindMap --> Reading
  Reading --> [*]
```

Three diagrams above; the harness spec asserts each becomes a non-zero SVG.
