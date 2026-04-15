import { create } from 'zustand'
import { devtools, persist, type StateStorage } from 'zustand/middleware'
import { trackEvent, type TelemetryEvent } from '../lib/telemetry'
import { resolveEnabledFeatures, enableFeature, disableFeature, isViewModeGated } from '../lib/feature-flags'
import type { PodcastScript } from '../lib/podcast'
import type { DiagramDSL } from '../lib/excalidraw-converter'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// IndexedDB-backed storage for Zustand persist — handles large markdown content
// without hitting localStorage's ~5MB limit. Connection is cached to avoid
// opening a new IDB connection on every read/write.
let cachedDb: IDBDatabase | null = null
let dbOpenPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb)
  if (!dbOpenPromise) {
    dbOpenPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('md-reader-zustand', 1)
      req.onupgradeneeded = () => { req.result.createObjectStore('state') }
      req.onsuccess = () => { cachedDb = req.result; resolve(req.result) }
      req.onerror = () => reject(req.error)
    })
  }
  return dbOpenPromise
}

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await getDb()
      const tx = db.transaction('state', 'readonly')
      const req = tx.objectStore('state').get(name)
      return new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
      })
    } catch { return null }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await getDb()
      const tx = db.transaction('state', 'readwrite')
      tx.objectStore('state').put(value, name)
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
    } catch { /* swallow */ }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await getDb()
      const tx = db.transaction('state', 'readwrite')
      tx.objectStore('state').delete(name)
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
    } catch { /* swallow */ }
  },
}

export type Theme = 'light' | 'dark' | 'sepia' | 'high-contrast'
export type ViewMode = 'read' | 'mindmap' | 'summary-cards' | 'treemap' | 'knowledge-graph' | 'coach' | 'podcast' | 'diagram' | 'workspace' | 'cross-doc-graph' | 'correlation' | 'similarity-map' | 'collection'

export interface TocEntry {
  id: string
  text: string
  level: number
}

export interface DocumentState {
  markdown: string
  fileName: string | null
  toc: TocEntry[]
  readingProgress: number
  activeSection: string | null
  theme: Theme
  fontSize: number
  viewMode: ViewMode
  ttsPlaying: boolean
  ttsSectionIndex: number
  workspaceMode: boolean
  activeDocId: number | null
  sidebarWidth: number
  chatWidth: number
  dyslexicFont: boolean
  readScrollTop: number
  setReadScrollTop: (top: number) => void

  setMarkdown: (md: string, fileName?: string) => void
  setFileName: (name: string) => void
  setToc: (toc: TocEntry[]) => void
  setReadingProgress: (progress: number) => void
  setActiveSection: (id: string | null) => void
  setTheme: (theme: Theme) => void
  setFontSize: (size: number) => void
  setViewMode: (mode: ViewMode) => void
  setTtsPlaying: (playing: boolean) => void
  setTtsSectionIndex: (index: number) => void
  setWorkspaceMode: (on: boolean) => void
  setActiveDocId: (id: number | null) => void
  setSidebarWidth: (w: number) => void
  setChatWidth: (w: number) => void
  setDyslexicFont: (on: boolean) => void
  // Cached generated content (survives tab switches)
  podcastScript: PodcastScript | null
  setPodcastScript: (script: PodcastScript | null) => void
  diagramDsl: DiagramDSL | null
  setDiagramDsl: (dsl: DiagramDSL | null) => void
  // Chat history — persists across view switches, Chat panel close/reopen,
  // AI Settings modal open, and backend re-detection. Cleared only when
  // the user switches to a different document (setMarkdown/openDocument/reset).
  chatMessages: ChatMessage[]
  setChatMessages: (messages: ChatMessage[]) => void
  appendChatMessage: (message: ChatMessage) => void
  clearChatMessages: () => void
  enabledFeatures: Set<string>
  toggleFeature: (id: string) => void
  refreshFeatureFlags: () => void
  openDocument: (md: string, fileName: string, docId: number) => void
  reset: () => void
  backToWorkspace: () => void
  backToCollection: () => void

  // Unified view state (added 2026-04-15)
  folderHandle: FileSystemDirectoryHandle | null
  folderFiles: Array<{ path: string; name: string }> | null
  folderFileContents: Map<string, string> | null
  activeFilePath: string | null
  sidebarCollapsed: boolean
  sidebarExpandedFile: string | null

  // Unified view actions
  setFolderSession: (
    handle: FileSystemDirectoryHandle | null,
    files: Array<{ path: string; name: string; content: string }>
  ) => void
  setActiveFile: (path: string | null) => void
  closeFolderSession: () => void
  toggleSidebar: () => void
  setSidebarExpandedFile: (path: string | null) => void
  navigateToPath: (relOrAbsPath: string) => boolean
}

// Persist theme/fontSize to localStorage — auto-detect system dark mode on first visit
const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
const savedTheme = (localStorage.getItem('md-reader-theme') as Theme) || (systemDark ? 'dark' : 'light')
const savedFontSize = parseInt(localStorage.getItem('md-reader-fontSize') ?? '18')
const savedSidebarWidth = parseInt(localStorage.getItem('md-reader-sidebarW') ?? '256')
const savedChatWidth = parseInt(localStorage.getItem('md-reader-chatW') ?? '320')

export const useStore = create<DocumentState>()(devtools(persist((set, get) => ({
  markdown: '',
  fileName: null,
  toc: [],
  readingProgress: 0,
  activeSection: null,
  theme: savedTheme,
  fontSize: savedFontSize,
  viewMode: 'read',
  ttsPlaying: false,
  ttsSectionIndex: 0,
  workspaceMode: false,
  activeDocId: null,
  sidebarWidth: savedSidebarWidth,
  chatWidth: savedChatWidth,
  dyslexicFont: localStorage.getItem('md-reader-dyslexic') === 'true',
  readScrollTop: 0,
  podcastScript: null,
  setPodcastScript: (script) => set({ podcastScript: script }),
  diagramDsl: null,
  setDiagramDsl: (dsl) => set({ diagramDsl: dsl }),
  chatMessages: [],
  setChatMessages: (messages) => set({ chatMessages: messages }),
  appendChatMessage: (message) => set((s) => ({ chatMessages: [...s.chatMessages, message] })),
  clearChatMessages: () => set({ chatMessages: [] }),
  enabledFeatures: resolveEnabledFeatures(),

  setMarkdown: (md, fileName) => {
    // Only count genuinely new document opens, not re-opens of the same content
    const prev = useStore.getState().markdown
    const isNewDoc = md && md.length > 0 && prev !== md
    if (isNewDoc) {
      const count = parseInt(localStorage.getItem('md-reader-docs-read') ?? '0')
      localStorage.setItem('md-reader-docs-read', String(count + 1))
      trackEvent('doc_opened')
    }
    set({
      markdown: md,
      fileName: fileName ?? null,
      readingProgress: 0,
      activeSection: null,
      viewMode: 'read',
      // Only clear chat history when the document actually changed — not on
      // every re-open of the same content (e.g., after AI settings save).
      ...(isNewDoc ? { chatMessages: [] } : {}),
    })
  },
  setFileName: (name) => set({ fileName: name }),
  setToc: (toc) => set({ toc }),
  setReadingProgress: (progress) => set({ readingProgress: progress }),
  setActiveSection: (id) => set({ activeSection: id }),
  setTheme: (theme) => {
    localStorage.setItem('md-reader-theme', theme)
    const themeEvents: Record<string, TelemetryEvent> = { dark: 'theme_dark', sepia: 'theme_sepia', light: 'theme_light', 'high-contrast': 'theme_high_contrast' }
    const event = themeEvents[theme]
    if (event) trackEvent(event)
    set({ theme })
  },
  setFontSize: (size) => { localStorage.setItem('md-reader-fontSize', String(size)); set({ fontSize: size }) },
  setViewMode: (mode) => {
    const viewEvents: Record<string, TelemetryEvent> = {
      read: 'view_read', mindmap: 'view_mindmap', 'summary-cards': 'view_cards',
      treemap: 'view_treemap', 'knowledge-graph': 'view_graph', coach: 'view_coach',
    }
    const event = viewEvents[mode]
    if (event) trackEvent(event)
    set({ viewMode: mode })
  },
  setTtsPlaying: (playing) => set({ ttsPlaying: playing }),
  setTtsSectionIndex: (index) => set({ ttsSectionIndex: index }),
  setWorkspaceMode: (on) => set({ workspaceMode: on }),
  setActiveDocId: (id) => set({ activeDocId: id }),
  setSidebarWidth: (w) => { localStorage.setItem('md-reader-sidebarW', String(w)); set({ sidebarWidth: w }) },
  setChatWidth: (w) => { localStorage.setItem('md-reader-chatW', String(w)); set({ chatWidth: w }) },
  setDyslexicFont: (on) => { localStorage.setItem('md-reader-dyslexic', String(on)); set({ dyslexicFont: on }) },
  setReadScrollTop: (top) => set({ readScrollTop: top }),
  toggleFeature: (id) => {
    const current = useStore.getState().enabledFeatures
    if (current.has(id)) {
      disableFeature(id)
      const next = new Set(current)
      next.delete(id)
      set({ enabledFeatures: next })
    } else {
      enableFeature(id)
      const next = new Set(current)
      next.add(id)
      set({ enabledFeatures: next })
    }
  },
  refreshFeatureFlags: () => {
    set({ enabledFeatures: resolveEnabledFeatures() })
  },
  openDocument: (md, fileName, docId) => set({
    markdown: md,
    fileName,
    activeDocId: docId,
    readingProgress: 0,
    activeSection: null,
    viewMode: 'read',
    chatMessages: [], // fresh conversation for a freshly opened document
  }),
  reset: () => set({ markdown: '', fileName: null, toc: [], readingProgress: 0, activeSection: null, viewMode: 'read', ttsPlaying: false, ttsSectionIndex: 0, activeDocId: null, workspaceMode: false, readScrollTop: 0, podcastScript: null, diagramDsl: null, chatMessages: [] }),
  backToWorkspace: () => set({ markdown: '', fileName: null, toc: [], viewMode: 'workspace', activeDocId: null }),
  backToCollection: () => set({ markdown: '', fileName: null, toc: [], viewMode: 'collection', activeDocId: null }),

  // Unified view state
  folderHandle: null,
  folderFiles: null,
  folderFileContents: null,
  activeFilePath: null,
  sidebarCollapsed: (typeof localStorage !== 'undefined'
    && localStorage.getItem('md-reader-sidebar-collapsed') === 'true'),
  sidebarExpandedFile: null,

  setFolderSession: (handle, files) => {
    const ordered = files.map(f => ({ path: f.path, name: f.name }))
    const contents = new Map<string, string>()
    files.forEach(f => contents.set(f.path, f.content))

    // Auto-select: prefer README.md (case-insensitive) else first file
    const readme = files.find(f => /^readme\.md$/i.test(f.name))
    const first = readme ?? files[0]

    set({
      folderHandle: handle,
      folderFiles: ordered,
      folderFileContents: contents,
      activeFilePath: first?.path ?? null,
      markdown: first?.content ?? '',
      fileName: first?.name ?? null,
    })
  },

  setActiveFile: (path) => {
    if (path === null) {
      set({ activeFilePath: null, markdown: '', fileName: null })
      return
    }
    const contents = get().folderFileContents
    if (!contents?.has(path)) return  // no-op for unknown path
    const file = get().folderFiles?.find(f => f.path === path)
    set({
      activeFilePath: path,
      markdown: contents.get(path) ?? '',
      fileName: file?.name ?? path,
    })
  },

  closeFolderSession: () => {
    set({
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      sidebarExpandedFile: null,
      markdown: '',
      fileName: null,
    })
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    set({ sidebarCollapsed: next })
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('md-reader-sidebar-collapsed', String(next))
    }
  },

  setSidebarExpandedFile: (path) => set({ sidebarExpandedFile: path }),

  navigateToPath: (relOrAbsPath) => {
    // Resolve intra-collection markdown link. Examples:
    //   './api.md' (relative to current file)
    //   'api.md'   (bare)
    //   '../docs/api.md' (parent-relative)
    //
    // Strategy: normalize by resolving against the currently active file's
    // directory, then look up in folderFiles. Returns true if the target
    // was found and setActiveFile was called; false otherwise.
    const files = get().folderFiles
    if (!files) return false

    const current = get().activeFilePath ?? ''
    const currentDir = current.includes('/') ? current.substring(0, current.lastIndexOf('/')) : ''

    // Strip leading './' and resolve '../' segments
    let target = relOrAbsPath.replace(/^\.\//, '')
    if (target.startsWith('../')) {
      const parts = currentDir.split('/').filter(Boolean)
      while (target.startsWith('../')) {
        parts.pop()
        target = target.slice(3)
      }
      target = parts.length > 0 ? `${parts.join('/')}/${target}` : target
    } else if (!target.startsWith('/') && currentDir) {
      target = `${currentDir}/${target}`
    }
    // Strip any leading slash for consistency with folderFiles path keys
    target = target.replace(/^\//, '')

    // Strip URL fragments like '#anchor' — anchor scroll happens after file load
    const fragmentIdx = target.indexOf('#')
    const targetPath = fragmentIdx >= 0 ? target.slice(0, fragmentIdx) : target

    const match = files.find(f => f.path === targetPath)
    if (!match) return false
    get().setActiveFile(match.path)
    return true
  },
}), {
  name: 'md-reader-session',
  storage: {
    getItem: async (name) => {
      const val = await idbStorage.getItem(name)
      return val ? JSON.parse(val) : null
    },
    setItem: async (name, value) => {
      await idbStorage.setItem(name, JSON.stringify(value))
    },
    removeItem: async (name) => {
      await idbStorage.removeItem(name)
    },
  },
  // If opened via browser extension (#url=...), clear rehydrated markdown so the extension handler loads fresh content
  merge: (persisted, current) => {
    const merged = { ...current, ...(persisted as Partial<DocumentState>) }
    // When opened via browser extension, clear cached content so fresh content loads
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.startsWith('#md=') || hash.startsWith('#url=') || hash === '#ext-pending') {
      merged.markdown = ''
      merged.fileName = null
      merged.toc = []
      merged.readingProgress = 0
      merged.activeSection = null
      merged.activeDocId = null
    }
    // If persisted viewMode is behind a disabled feature flag, reset to 'read'
    if (merged.viewMode) {
      const gatedFlag = isViewModeGated(merged.viewMode as ViewMode)
      if (gatedFlag && !resolveEnabledFeatures().has(gatedFlag)) {
        merged.viewMode = 'read'
      }
    }
    return merged
  },
  partialize: (state) => ({
    markdown: state.markdown,
    fileName: state.fileName,
    toc: state.toc,
    readingProgress: state.readingProgress,
    activeSection: state.activeSection,
    viewMode: state.viewMode,
    workspaceMode: state.workspaceMode,
    activeDocId: state.activeDocId,
    chatMessages: state.chatMessages, // persist conversation across reloads within the same doc
  }) as unknown as DocumentState, // Safe: persist only serializes these fields; missing fields use defaults on rehydration
}), { name: 'md-reader', enabled: import.meta.env.DEV }))

// Listen for OS dark mode changes — auto-switch if user is on light/dark (not sepia/high-contrast)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const saved = localStorage.getItem('md-reader-theme')
    if (!saved || saved === 'light' || saved === 'dark') {
      useStore.getState().setTheme(e.matches ? 'dark' : 'light')
    }
  })
}
