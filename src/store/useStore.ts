import { create } from 'zustand'
import { devtools, persist, type StateStorage } from 'zustand/middleware'
import { trackEvent, type TelemetryEvent } from '../lib/telemetry'

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
export type ViewMode = 'read' | 'mindmap' | 'summary-cards' | 'treemap' | 'knowledge-graph' | 'coach' | 'workspace' | 'cross-doc-graph' | 'correlation' | 'similarity-map' | 'collection'

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
  openDocument: (md: string, fileName: string, docId: number) => void
  reset: () => void
  backToWorkspace: () => void
  backToCollection: () => void
}

// Persist theme/fontSize to localStorage — auto-detect system dark mode on first visit
const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
const savedTheme = (localStorage.getItem('md-reader-theme') as Theme) || (systemDark ? 'dark' : 'light')
const savedFontSize = parseInt(localStorage.getItem('md-reader-fontSize') ?? '18')
const savedSidebarWidth = parseInt(localStorage.getItem('md-reader-sidebarW') ?? '256')
const savedChatWidth = parseInt(localStorage.getItem('md-reader-chatW') ?? '320')

export const useStore = create<DocumentState>()(devtools(persist((set) => ({
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

  setMarkdown: (md, fileName) => {
    // Only count genuinely new document opens, not re-opens of the same content
    const prev = useStore.getState().markdown
    if (md && md.length > 0 && prev !== md) {
      const count = parseInt(localStorage.getItem('md-reader-docs-read') ?? '0')
      localStorage.setItem('md-reader-docs-read', String(count + 1))
      trackEvent('doc_opened')
    }
    set({ markdown: md, fileName: fileName ?? null, readingProgress: 0, activeSection: null, viewMode: 'read' })
  },
  setFileName: (name) => set({ fileName: name }),
  setToc: (toc) => set({ toc }),
  setReadingProgress: (progress) => set({ readingProgress: progress }),
  setActiveSection: (id) => set({ activeSection: id }),
  setTheme: (theme) => { localStorage.setItem('md-reader-theme', theme); set({ theme }) },
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
  openDocument: (md, fileName, docId) => set({
    markdown: md,
    fileName,
    activeDocId: docId,
    readingProgress: 0,
    activeSection: null,
    viewMode: 'read',
  }),
  reset: () => set({ markdown: '', fileName: null, toc: [], readingProgress: 0, activeSection: null, viewMode: 'read', ttsPlaying: false, ttsSectionIndex: 0, activeDocId: null, workspaceMode: false, readScrollTop: 0 }),
  backToWorkspace: () => set({ markdown: '', fileName: null, toc: [], viewMode: 'workspace', activeDocId: null }),
  backToCollection: () => set({ markdown: '', fileName: null, toc: [], viewMode: 'collection', activeDocId: null }),
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
  partialize: (state) => ({
    markdown: state.markdown,
    fileName: state.fileName,
    toc: state.toc,
    readingProgress: state.readingProgress,
    activeSection: state.activeSection,
    viewMode: state.viewMode,
    workspaceMode: state.workspaceMode,
    activeDocId: state.activeDocId,
  }) as unknown as DocumentState, // Safe: persist only serializes these fields; missing fields use defaults on rehydration
}), { name: 'md-reader', enabled: import.meta.env.DEV }))
