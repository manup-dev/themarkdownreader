// @md-reader/core — framework-agnostic surface.
//
// This package is a publish handle for the framework-agnostic primitives that
// already live in the repo root `src/lib/`. Phase 0 ships pure re-exports;
// later phases may relocate sources here. Anything React-only (Provider,
// hooks, components, Dexie adapter) belongs to `@md-reader/react` and must
// NOT be exported from this entry.

// Anchor & markdown primitives
export { captureAnchor, resolveAnchor, lineWordFromOffset } from '../../../src/lib/anchor'
export type { TextAnchor } from '../../../src/lib/anchor'
export { extractToc, chunkMarkdown, wordCount, slugify } from '../../../src/lib/markdown'

// Annotation WAL — public surface
export {
  SCHEMA_VERSION as ANNOTATION_SCHEMA_VERSION,
  SCHEMA_ID as ANNOTATION_SCHEMA_ID,
  encodeWal,
  decodeWal,
  materialize,
  KNOWN_OPS as KNOWN_ANNOTATION_OPS,
} from '../../../src/lib/annotation-events'
export type {
  AnnotationEvent,
  HeaderEvent,
  HighlightAddEvent,
  HighlightDelEvent,
  HighlightEditEvent,
  CommentAddEvent,
  CommentEditEvent,
  CommentResolveEvent,
  CommentDelEvent,
  CheckpointEvent,
  UnknownEvent,
  MaterializedHighlight,
  MaterializedComment,
  DocState as AnnotationDocState,
  AnchorCoords,
} from '../../../src/lib/annotation-events'

export { AnnotationLog, makeHeader } from '../../../src/lib/annotation-log'
export type { AnnotationSink, StoredEvent, CompactResult } from '../../../src/lib/annotation-log'

export { SaveScheduler, IMMEDIATE_OPS, DEBOUNCED_OPS } from '../../../src/lib/save-scheduler'
export type { SchedulerOptions, TimerLike } from '../../../src/lib/save-scheduler'

// Share-url + remote adapters
export {
  parseShareUrl,
  buildUrlPairShare,
  buildInlineShare,
  buildGithubRepoShare,
  siblingAnnotUrl,
  normalizeGithubUrl,
  ensureSafeFetchUrl,
  base64urlEncode,
  base64urlDecode,
} from '../../../src/lib/share-url'
export type { ShareHandle, ShareKind, SafeUrlResult } from '../../../src/lib/share-url'

export {
  HttpRemoteAdapter,
  GithubRemoteAdapter,
  defaultRemoteAdapter,
} from '../../../src/lib/remote-document'
export type { RemoteDocumentAdapter, RemoteDocument, FolderEntry } from '../../../src/lib/remote-document'

export {
  buildShareForDocument,
  sidecarBasename,
  downloadSidecar,
  importRemoteEventsToLocal,
} from '../../../src/lib/share-builder'
export type { ShareInputs, BuiltShare } from '../../../src/lib/share-builder'

export {
  diffEvents,
  diffStates,
  isEmpty as isDiffEmpty,
  buildPrTitle,
  buildPrBody,
} from '../../../src/lib/annotation-diff'
export type {
  AnnotationDiff,
  HighlightChange,
  CommentChange,
  PrTextOptions,
} from '../../../src/lib/annotation-diff'

// Storage adapter contract + data types
export type {
  StorageAdapter,
  StoredDocument,
  Highlight,
  Comment,
  DocumentAnalysis,
  CachedAudio,
  CollectionCache,
  AddDocumentResult,
  DocLinkExpanded,
  SearchHit,
  DocStats,
} from '../../../src/types/storage-adapter'
