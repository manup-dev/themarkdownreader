# @md-reader/core

Framework-agnostic primitives that power md-reader: text-quote anchor capture/resolve, markdown chunking + TOC extraction, the annotation write-ahead log (WAL) with checkpoints, the save scheduler, the share-URL grammar with remote-document adapters, and the `StorageAdapter` interface plus shared domain types.

No React, no DOM, no zustand. Anything UI-shaped lives in `@md-reader/react`.

```ts
import {
  captureAnchor,
  resolveAnchor,
  extractToc,
  encodeWal,
  decodeWal,
  parseShareUrl,
  type StorageAdapter,
  type Highlight,
} from '@md-reader/core'

const anchor = captureAnchor(markdown, selection)
const toc = extractToc(markdown)
```

Phase 0 ships as a workspace shim that re-exports from the existing repo root `src/lib/`. Later phases may relocate the source here without changing the public surface.
