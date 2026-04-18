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
export { captureAnchor, resolveAnchor } from './lib/anchor'
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
