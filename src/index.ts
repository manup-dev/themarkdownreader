// Provider & hooks
export { MdReaderProvider } from './provider'
export { useAdapter, useDocument, useTheme, useViewMode, useChat, useFeatures } from './provider/hooks'

// Storage
export type { StorageAdapter } from './types/storage-adapter'
export { DexieAdapter } from './adapters/dexie-adapter'

// Core components
export { Reader } from './components/Reader'
export { SelectionMenu } from './components/SelectionMenu'
export { CommentsPanel } from './components/CommentsPanel'
export { Toolbar } from './components/Toolbar'

// Feature components
export { Chat } from './components/Chat'
export { PodcastPlayer } from './components/PodcastPlayer'
export { MindMapView } from './components/MindMap'
export { KnowledgeGraphView } from './components/KnowledgeGraph'
export { CoachView } from './components/Coach'
export { Workspace } from './components/Workspace'
export { Upload } from './components/Upload'
export { PromptBuilder } from './components/PromptBuilder'
export { SimilarityMap } from './components/SimilarityMap'
export { CorrelationView } from './components/CorrelationView'
export { CollectionView } from './components/CollectionView'

// Utilities (pure functions)
export { captureAnchor, resolveAnchor, lineWordFromOffset } from './lib/anchor'
export type { TextAnchor } from './lib/anchor'
export { extractToc, chunkMarkdown, wordCount, slugify } from './lib/markdown'

// Domain types
export type {
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
} from './types/storage-adapter'

// Annotation WAL — public surface kept intentionally narrow. Low-level
// reducer primitives (`reduce`, `dedupeEvents`, `emptyState`), the legacy
// projection helpers, and the in-memory test sink live with the source
// and are reachable via deep imports for internal tooling only.
export {
  SCHEMA_VERSION as ANNOTATION_SCHEMA_VERSION,
  SCHEMA_ID as ANNOTATION_SCHEMA_ID,
  encodeWal,
  decodeWal,
  materialize,
  KNOWN_OPS as KNOWN_ANNOTATION_OPS,
} from './lib/annotation-events'
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
} from './lib/annotation-events'

export { AnnotationLog, makeHeader } from './lib/annotation-log'
export type { AnnotationSink, StoredEvent, CompactResult } from './lib/annotation-log'

export { SaveScheduler, IMMEDIATE_OPS, DEBOUNCED_OPS } from './lib/save-scheduler'
export type { SchedulerOptions, TimerLike } from './lib/save-scheduler'

// Sharing — URL grammar, remote fetch, share builder, share intake
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
} from './lib/share-url'
export type { ShareHandle, ShareKind, SafeUrlResult } from './lib/share-url'

export {
  HttpRemoteAdapter,
  GithubRemoteAdapter,
  defaultRemoteAdapter,
} from './lib/remote-document'
export type { RemoteDocumentAdapter, RemoteDocument, FolderEntry } from './lib/remote-document'

export {
  buildShareForDocument,
  sidecarBasename,
  downloadSidecar,
  importRemoteEventsToLocal,
} from './lib/share-builder'
export type { ShareInputs, BuiltShare } from './lib/share-builder'

export { loadShareFromHash } from './lib/share-loader'
export type { LoadShareResult, FolderShareResult, ShareIntakeResult, LoadShareOptions } from './lib/share-loader'

export { loadRepoFolderFromHash } from './lib/repo-browser'
export type { RepoFolderResult, LoadRepoFolderOptions } from './lib/repo-browser'

export { fetchWorkspaceConfig, githubWorkspaceRootUrl } from './lib/workspace-config'
export type { WorkspaceConfig } from './lib/workspace-config'

export {
  diffEvents,
  diffStates,
  isEmpty as isDiffEmpty,
  buildPrTitle,
  buildPrBody,
} from './lib/annotation-diff'
export type {
  AnnotationDiff,
  HighlightChange,
  CommentChange,
  PrTextOptions,
} from './lib/annotation-diff'

export { ShareDialog } from './components/ShareDialog'
export { RemoteBanner } from './components/RemoteBanner'
export { RepoBrowser } from './components/RepoBrowser'
export { AnnotationDiffView } from './components/AnnotationDiffView'
export { ProposeChangesDialog } from './components/ProposeChangesDialog'
