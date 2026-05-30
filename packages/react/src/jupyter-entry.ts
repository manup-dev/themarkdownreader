// Slim entry for the JupyterLab extension build.
// Only re-exports the symbols the extension actually mounts.
// Keeps webpack tree-shaking deterministic so Workspace / MindMap /
// KnowledgeGraph / WebLLM / transformers / Kokoro / Excalidraw never
// enter the lab-extension bundle.

export { MdReaderProvider } from '../../../src/provider/MdReaderProvider'
export { useAdapter, useDocument, useTheme } from '../../../src/provider/hooks'
export { Reader } from '../../../src/components/Reader'
export { Toolbar } from '../../../src/components/Toolbar'

export type { StorageAdapter } from '../../../src/types/storage-adapter'
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
} from '../../../src/types/storage-adapter'
