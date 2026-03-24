import { create } from 'zustand'
import { devtools, persist, type StateStorage } from 'zustand/middleware'

// IndexedDB-backed storage for Zustand persist — handles large markdown content
// without hitting localStorage's ~5MB limit
const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const dbReq = indexedDB.open('md-reader-zustand', 1)
    return new Promise((resolve) => {
      dbReq.onupgradeneeded = () => { dbReq.result.createObjectStore('state') }
      dbReq.onsuccess = () => {
        try {
          const tx = dbReq.result.transaction('state', 'readonly')
          const req = tx.objectStore('state').get(name)
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => resolve(null)
        } catch { resolve(null) }
      }
      dbReq.onerror = () => resolve(null)
    })
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const dbReq = indexedDB.open('md-reader-zustand', 1)
    return new Promise((resolve) => {
      dbReq.onupgradeneeded = () => { dbReq.result.createObjectStore('state') }
      dbReq.onsuccess = () => {
        try {
          const tx = dbReq.result.transaction('state', 'readwrite')
          tx.objectStore('state').put(value, name)
          tx.oncomplete = () => resolve()
        } catch { resolve() }
      }
      dbReq.onerror = () => resolve()
    })
  },
  removeItem: async (name: string): Promise<void> => {
    const dbReq = indexedDB.open('md-reader-zustand', 1)
    return new Promise((resolve) => {
      dbReq.onupgradeneeded = () => { dbReq.result.createObjectStore('state') }
      dbReq.onsuccess = () => {
        try {
          const tx = dbReq.result.transaction('state', 'readwrite')
          tx.objectStore('state').delete(name)
          tx.oncomplete = () => resolve()
        } catch { resolve() }
      }
      dbReq.onerror = () => resolve()
    })
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
    const count = parseInt(localStorage.getItem('md-reader-docs-read') ?? '0')
    localStorage.setItem('md-reader-docs-read', String(count + 1))
    set({ markdown: md, fileName: fileName ?? null, readingProgress: 0, activeSection: null, viewMode: 'read' })
  },
  setFileName: (name) => set({ fileName: name }),
  setToc: (toc) => set({ toc }),
  setReadingProgress: (progress) => set({ readingProgress: progress }),
  setActiveSection: (id) => set({ activeSection: id }),
  setTheme: (theme) => { localStorage.setItem('md-reader-theme', theme); set({ theme }) },
  setFontSize: (size) => { localStorage.setItem('md-reader-fontSize', String(size)); set({ fontSize: size }) },
  setViewMode: (mode) => set({ viewMode: mode }),
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
    readScrollTop: state.readScrollTop,
  }),
}), { name: 'md-reader', enabled: import.meta.env.DEV }))
