import { create } from 'zustand'
import { devtools, persist, type StateStorage } from 'zustand/middleware'
import { trackEvent, type TelemetryEvent } from '../lib/telemetry'
import { resolveEnabledFeatures, enableFeature, disableFeature, isViewModeGated } from '../lib/feature-flags'
import type { PodcastScript } from '../lib/podcast'
import type { DiagramDSL } from '../lib/excalidraw-converter'
import type { AnnotationEvent } from '../lib/annotation-events'
import { emptyTab, newTabId, type Tab, type TabPayload } from '../lib/tabs-types'
import { decideOpen } from '../lib/smart-open'
import { addOrTouchRecent } from '../lib/recents'
import { putTabContent, getTabContent } from '../lib/tabContent'
import { putHandle, getHandle } from '../lib/handleStore'
import { ancestorDirs } from '../lib/file-tree'
import { reopenDirectory } from '../lib/fs-access'
import { showToast } from '../lib/toast'

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

// In-session caches bridging tab snapshots to folder/file bodies that don't
// belong on the Tab record itself. Persistence across reload is wired by a
// later task (tabContent table). These maps live at module scope so they're
// shared by all snapshot/hydrate calls in a single session.
const folderBodyCache = new Map<string, {
  folderFiles: DocumentState['folderFiles']
  folderFileContents: DocumentState['folderFileContents']
}>()
const fileBodyCache = new Map<string, string>()
// Per-tab chat history. Same lifecycle as the body caches above: primed on
// snapshot, read on hydrate, dropped on closeTab/reset. Chat is doc-scoped
// (see the contract at the chatMessages declaration), so it must travel
// with tabs rather than leak across them (B3).
const tabChatCache = new Map<string, ChatMessage[]>()

// Tab snapshot / hydrate helpers — pure functions over the state shape,
// plus the module-scope body caches above (which act as an in-session bridge
// for per-tab folder/file content that doesn't live on the Tab record).
function snapshotIntoTab(tab: Tab, state: DocumentState): Tab {
  const now = Date.now()
  tabChatCache.set(tab.id, state.chatMessages)
  if (tab.kind === 'folder') {
    folderBodyCache.set(tab.id, {
      folderFiles: state.folderFiles,
      folderFileContents: state.folderFileContents,
    })
    return {
      ...tab,
      activeFilePath: state.activeFilePath ?? tab.activeFilePath ?? null,
      viewMode: state.viewMode,
      scrollProgress: state.readingProgress,
      activeDocId: state.activeDocId,
      lastAccessedAt: now,
    }
  }
  if (tab.kind === 'file') {
    fileBodyCache.set(tab.id, state.markdown)
    return {
      ...tab,
      viewMode: state.viewMode,
      scrollProgress: state.readingProgress,
      activeDocId: state.activeDocId,
      lastAccessedAt: now,
    }
  }
  return { ...tab, activeDocId: state.activeDocId, lastAccessedAt: now }
}

function hydrateFromTab(tab: Tab): Partial<DocumentState> {
  if (tab.kind === 'folder') {
    const cached = folderBodyCache.get(tab.id)
    const contents = cached?.folderFileContents ?? null
    const body = (tab.activeFilePath && contents?.get(tab.activeFilePath)) || ''
    return {
      folderFiles: cached?.folderFiles ?? null,
      folderFileContents: contents,
      // handle is per-session, won't survive switch — task 11 wires re-permission
      folderHandle: null,
      activeFilePath: tab.activeFilePath ?? null,
      viewMode: tab.viewMode,
      readingProgress: tab.scrollProgress,
      markdown: body,
      fileName: tab.activeFilePath
        ? (tab.activeFilePath.split('/').pop() ?? null)
        : null,
      activeDocId: tab.activeDocId ?? null,
      chatMessages: tabChatCache.get(tab.id) ?? [],
    }
  }
  if (tab.kind === 'file') {
    const body = fileBodyCache.get(tab.id) ?? ''
    return {
      viewMode: tab.viewMode,
      readingProgress: tab.scrollProgress,
      fileName: tab.fileName ?? null,
      activeFilePath: null,
      folderFiles: null,
      folderFileContents: null,
      folderHandle: null,
      markdown: body,
      activeDocId: tab.activeDocId ?? null,
      chatMessages: tabChatCache.get(tab.id) ?? [],
    }
  }
  // empty
  return {
    markdown: '', fileName: null, activeFilePath: null,
    folderFiles: null, folderFileContents: null, folderHandle: null,
    viewMode: 'read', readingProgress: 0,
    activeDocId: null, chatMessages: [],
  }
}

function payloadToSingulars(payload: TabPayload): Partial<DocumentState> {
  if (payload.kind === 'folder') {
    const ordered = payload.files.map((f) => ({
      path: f.path, name: f.name, lastModified: f.lastModified ?? 0,
    }))
    const contents = new Map<string, string>()
    payload.files.forEach((f) => contents.set(f.path, f.content))
    const first = payload.files[0]
    return {
      folderHandle: payload.handle,
      folderFiles: ordered,
      folderFileContents: contents,
      activeFilePath: first?.path ?? null,
      markdown: first?.content ?? '',
      fileName: first?.name ?? null,
      activeDocId: null,   // fresh content in the tab is not (yet) a library doc
      chatMessages: [],    // chat is doc-scoped — new doc, new conversation
    }
  }
  return {
    markdown: payload.content,
    fileName: payload.fileName,
    folderHandle: null,
    folderFiles: null,
    folderFileContents: null,
    activeFilePath: null,
    activeDocId: null,   // fresh content in the tab is not (yet) a library doc
    chatMessages: [],    // chat is doc-scoped — new doc, new conversation
  }
}

function applyPayloadToTab(tab: Tab, payload: TabPayload): Tab {
  const now = Date.now()
  if (payload.kind === 'folder') {
    const handleKey = payload.handle ? (tab.handleKey ?? newTabId()) : undefined
    return {
      ...tab,
      kind: 'folder',
      title: payload.folderName,
      folderName: payload.folderName,
      handleKey,
      activeFilePath: payload.files[0]?.path ?? null,
      fileName: undefined,
      contentKey: undefined,
      activeDocId: null,
      lastAccessedAt: now,
    }
  }
  const contentKey = tab.contentKey ?? newTabId()
  return {
    ...tab,
    kind: 'file',
    title: payload.fileName,
    fileName: payload.fileName,
    contentKey,
    folderName: undefined,
    handleKey: undefined,
    activeFilePath: undefined,
    activeDocId: null,
    lastAccessedAt: now,
  }
}

// Track in-flight persistence writes so tests can deterministically await
// them instead of sleeping. Internal — exposed via the persistSettled() helper.
// Writes are chained so order matches the call sequence and a single await
// drains everything queued up to that point.
let _persistInflight: Promise<void> = Promise.resolve()

export function persistSettled(): Promise<void> {
  return _persistInflight
}

async function persistPayload(tab: Tab, payload: TabPayload): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      if (payload.kind === 'folder') {
        if (payload.handle && tab.handleKey) {
          await putHandle(tab.handleKey, payload.handle)
        }
        await addOrTouchRecent({
          kind: 'folder',
          name: payload.folderName,
          handleKey: tab.handleKey,
        })
      } else {
        if (tab.contentKey) {
          await putTabContent(tab.contentKey, payload.fileName, payload.content)
          await addOrTouchRecent({
            kind: 'file',
            name: payload.fileName,
            contentKey: tab.contentKey,
          })
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('persistPayload failed', e)
    }
  }
  // Chain to keep ordering + observability for tests.
  _persistInflight = _persistInflight.then(run)
  return _persistInflight
}

export type Theme = 'light' | 'dark' | 'sepia' | 'high-contrast'
export type ViewMode = 'read' | 'mindmap' | 'summary-cards' | 'treemap' | 'knowledge-graph' | 'coach' | 'podcast' | 'diagram' | 'workspace' | 'cross-doc-graph' | 'correlation' | 'similarity-map' | 'collection' | 'plan'
export type FolderSortMode = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc' | 'custom'

// Per-collection persistence for sidebar tree expand state + manual order,
// scoped by folder name so different folders remember independently.
const expandedKey = (folder: string) => `md-reader-folder-expanded:${folder}`
const manualOrderKey = (folder: string) => `md-reader-folder-order:${folder}`

function loadExpandedDirs(folder: string): string[] {
  if (typeof localStorage === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(expandedKey(folder)) ?? '[]') } catch { return [] }
}
function saveExpandedDirs(folder: string, dirs: string[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(expandedKey(folder), JSON.stringify(dirs)) } catch { /* quota */ }
}
function loadManualOrder(folder: string): Record<string, string[]> {
  if (typeof localStorage === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(manualOrderKey(folder)) ?? '{}') } catch { return {} }
}
function saveManualOrder(folder: string, order: Record<string, string[]>): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(manualOrderKey(folder), JSON.stringify(order)) } catch { /* quota */ }
}

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
  // Auto-hide reader chrome (tab strip + toolbar) on scroll-down to reclaim
  // vertical space. `autoHideHeader` is the persisted user preference;
  // `headerHidden` is ephemeral live state driven by the read-view scroll
  // direction (never persisted).
  autoHideHeader: boolean
  headerHidden: boolean
  setAutoHideHeader: (on: boolean) => void
  setHeaderHidden: (hidden: boolean) => void
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
  folderFiles: Array<{ path: string; name: string; lastModified: number }> | null
  folderFileContents: Map<string, string> | null
  activeFilePath: string | null
  sidebarCollapsed: boolean
  sidebarExpandedFile: string | null
  folderSortMode: FolderSortMode
  // Expanded folder dir paths in the file tree (e.g. 'docs', 'docs/api').
  folderExpandedDirs: string[]
  // Manual drag-reorder: dir path → ordered child paths. Active only while
  // folderSortMode === 'custom'.
  folderManualOrder: Record<string, string[]>

  // Unified view actions
  setFolderSession: (
    handle: FileSystemDirectoryHandle | null,
    files: Array<{ path: string; name: string; content: string; lastModified?: number }>
  ) => void
  setActiveFile: (path: string | null) => void
  closeFolderSession: () => void
  toggleSidebar: () => void
  setSidebarExpandedFile: (path: string | null) => void
  setFolderSortMode: (mode: FolderSortMode) => void
  toggleFolderDir: (path: string) => void
  setFolderManualOrder: (dir: string, order: string[]) => void
  navigateToPath: (relOrAbsPath: string) => boolean
  hydrateFolderFromCache: () => Promise<void>
  refreshFolder: () => Promise<{ ok: true; added: number; changed: number; removed: number } | { ok: false; reason: string }>

  // Tabs
  tabs: Tab[]
  activeTabId: string | null
  newEmptyTab: () => string
  closeTab: (id: string) => void
  switchTab: (id: string) => void
  /** Re-read a folder tab's directory from its persisted handle (re-requesting
   *  permission if needed) and restore the folder view into the active tab.
   *  Flashes an error toast if the folder was moved / access denied / handle
   *  lost. The tab must already be active when called. */
  reopenFolderTab: (tabId: string) => Promise<void>
  openInCurrentTab: (payload: TabPayload) => void
  openInNewTab: (payload: TabPayload) => void
  openSmart: (payload: TabPayload) => void

  // Remote-share state — set when the app loads a #url=… share. Drives
  // the RemoteBanner and the Fork action. Null when the open document
  // is local only.
  remoteShare: RemoteShareState | null
  setRemoteShare: (value: RemoteShareState | null) => void
}

export interface RemoteShareState {
  /** The source URL the doc was fetched from (the share's `#url=`). */
  sourceUrl: string
  /** Display string for the share URL itself, for the "open original" link. */
  shareUrl: string
  /** Author identifier from the WAL header, if known. */
  createdBy: string | null
  /** Materialized counts for the banner. */
  highlightCount: number
  commentCount: number
  /** Whether the user has forked yet — disables the Fork button when true. */
  forked: boolean
  /** True when the local doc's hash differs from the share's expected hash. */
  driftWarning: boolean
  /**
   * The remote events as fetched. Stashed so the "Propose changes" diff
   * view can compute the delta against the user's current local state
   * without re-fetching the share. Not persisted (partialize excludes
   * remoteShare), so keeping this as a typed array avoids a round-trip
   * through JSONL on every dialog open.
   */
  originalEvents: AnnotationEvent[]
  /** Local Dexie id of the document — needed to read current state for the diff. */
  docId: number | null
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
  autoHideHeader: localStorage.getItem('md-reader-autohide-header') === 'true',
  headerHidden: false,
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
    // Telemetry (unchanged)
    const prev = useStore.getState().markdown
    const isNewDoc = md && md.length > 0 && prev !== md
    if (isNewDoc) {
      const count = parseInt(localStorage.getItem('md-reader-docs-read') ?? '0')
      localStorage.setItem('md-reader-docs-read', String(count + 1))
      trackEvent('doc_opened')
    }
    // Tab routing: only when this looks like a "real document open" — both
    // body and fileName provided. Transient updates (empty md, fileName-less
    // pushes from chat/preview) bypass the tab system.
    if (md && md.length > 0 && fileName) {
      get().openSmart({ kind: 'file', fileName, content: md })
      return
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
  setAutoHideHeader: (on) => {
    localStorage.setItem('md-reader-autohide-header', String(on))
    // Turning the preference off must always restore the chrome, otherwise a
    // user who toggles it off while scrolled-down would be left with no chrome.
    set(on ? { autoHideHeader: on } : { autoHideHeader: on, headerHidden: false })
  },
  setHeaderHidden: (hidden) => set({ headerHidden: hidden }),
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
  openDocument: (md, fileName, docId) => {
    get().openSmart({ kind: 'file', fileName, content: md })
    set({ activeDocId: docId, chatMessages: [] })
  },
  reset: () => {
    folderBodyCache.clear()
    fileBodyCache.clear()
    tabChatCache.clear()
    const fresh = emptyTab()
    set({
      markdown: '', fileName: null, toc: [], readingProgress: 0, activeSection: null,
      viewMode: 'read', ttsPlaying: false, ttsSectionIndex: 0, activeDocId: null,
      workspaceMode: false, readScrollTop: 0, podcastScript: null, diagramDsl: null,
      chatMessages: [],
      tabs: [fresh], activeTabId: fresh.id,
    })
  },
  backToWorkspace: () => set({ viewMode: 'workspace' }),
  backToCollection: () => set({ viewMode: 'collection' }),

  // Unified view state
  folderHandle: null,
  folderFiles: null,
  folderFileContents: null,
  activeFilePath: null,
  tabs: [],
  activeTabId: null,
  sidebarCollapsed: (typeof localStorage !== 'undefined'
    && localStorage.getItem('md-reader-sidebar-collapsed') === 'true'),
  sidebarExpandedFile: null,
  folderSortMode: (typeof localStorage !== 'undefined'
    && (localStorage.getItem('md-reader-folder-sort') as FolderSortMode))
    || 'name-asc',
  folderExpandedDirs: [],
  folderManualOrder: {},

  setFolderSession: (handle, files) => {
    const folderName = handle?.name ?? '__cache__'
    // Determine chosen file using the same logic as before:
    // persisted active-file, then README, then first.
    const persisted = typeof localStorage !== 'undefined'
      ? localStorage.getItem(`md-reader-active-file:${folderName}`)
      : null
    let chosenFile = persisted ? files.find((f) => f.path === persisted) : undefined
    if (!chosenFile) {
      chosenFile = files.find((f) => /^readme\.md$/i.test(f.name)) ?? files[0]
    }
    // Route through smart-open — this handles tab creation/focus/fill.
    get().openSmart({ kind: 'folder', folderName, handle, files })

    // Restore per-collection tree state. Prune manual-order entries that
    // reference paths no longer on disk (added/removed files); if nothing
    // survives, drop out of 'custom' sort back to the persisted named mode.
    const existingPaths = new Set(files.map((f) => f.path))
    const rawManual = loadManualOrder(folderName)
    const manual: Record<string, string[]> = {}
    for (const [dir, order] of Object.entries(rawManual)) {
      const kept = order.filter((p) => existingPaths.has(p))
      if (kept.length) manual[dir] = kept
    }
    saveManualOrder(folderName, manual)
    const hasManual = Object.keys(manual).length > 0
    if (get().folderSortMode === 'custom' && !hasManual) {
      set({ folderSortMode: 'name-asc' })
    }
    // Expanded dirs: persisted set ∪ ancestors of the chosen file so the
    // active file is never hidden inside a collapsed branch on load.
    const expanded = new Set(loadExpandedDirs(folderName))
    if (chosenFile) for (const d of ancestorDirs(chosenFile.path)) expanded.add(d)
    const expandedDirs = [...expanded]
    saveExpandedDirs(folderName, expandedDirs)
    set({ folderExpandedDirs: expandedDirs, folderManualOrder: manual })

    // After openSmart, override activeFilePath to the chosen file (openSmart
    // defaults to files[0]).
    if (chosenFile) {
      const { tabs: curTabs, activeTabId } = get()
      set({
        activeFilePath: chosenFile.path,
        markdown: chosenFile.content,
        fileName: chosenFile.name,
        tabs: curTabs.map((t) => t.id === activeTabId
          ? { ...t, activeFilePath: chosenFile!.path }
          : t,
        ),
      })
      // Mark chosen as viewed (mirror prior behavior)
      if (typeof localStorage !== 'undefined') {
        try {
          const viewedKey = `md-reader-viewed-files:${folderName}`
          let viewed: Record<string, boolean> = {}
          try { viewed = JSON.parse(localStorage.getItem(viewedKey) ?? '{}') } catch { /* ignore */ }
          if (!viewed[chosenFile.path]) {
            viewed[chosenFile.path] = true
            localStorage.setItem(viewedKey, JSON.stringify(viewed))
          }
        } catch { /* quota — non-fatal */ }
      }
    }
  },

  newEmptyTab: () => {
    const t = emptyTab()
    const { tabs, activeTabId } = get()
    // Snapshot the leaving tab so its body survives the switch — otherwise
    // legacy-synthesized tabs (whose caches were never primed) lose their
    // markdown when the user opens a new empty tab and then switches back.
    const updatedExisting = tabs.map((existing) =>
      existing.id === activeTabId ? snapshotIntoTab(existing, get()) : existing,
    )
    set({
      tabs: [...updatedExisting, t],
      activeTabId: t.id,
      markdown: '',
      fileName: null,
      activeFilePath: null,
      folderFiles: null,
      folderFileContents: null,
      folderHandle: null,
      viewMode: 'read',
      readingProgress: 0,
      activeDocId: null,
      chatMessages: [],
    })
    return t.id
  },
  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const next = tabs.slice(0, idx).concat(tabs.slice(idx + 1))
    let newActive = activeTabId
    if (activeTabId === id) {
      const neighbor = next[idx] ?? next[idx - 1] ?? null
      newActive = neighbor?.id ?? null
    }
    // Side effect: clean per-tab in-session body caches only. tabContent +
    // recents are intentionally kept — re-opening from recents must stay fast.
    // tabContent is reaped when its recents entry is removed or LRU-evicted
    // (see src/lib/recents.ts).
    folderBodyCache.delete(id)
    fileBodyCache.delete(id)
    tabChatCache.delete(id)
    if (next.length === 0) {
      const fresh = emptyTab()
      // Reset doc-scoped singulars too — previously the closed tab's
      // markdown/activeDocId/chatMessages leaked into the fresh empty tab.
      set({ tabs: [fresh], activeTabId: fresh.id, ...hydrateFromTab(fresh) })
      return
    }
    set({ tabs: next, activeTabId: newActive })
    // If we're activating a different tab, hydrate its singulars
    if (newActive && newActive !== activeTabId) {
      const target = next.find((t) => t.id === newActive)
      if (target) {
        set(hydrateFromTab(target))
        // Same cross-reload fallback as switchTab.
        if (target.kind === 'file' && target.contentKey && !fileBodyCache.has(target.id)) {
          void getTabContent(target.contentKey).then((row) => {
            if (row && get().activeTabId === target.id) {
              fileBodyCache.set(target.id, row.body)
              set({ markdown: row.body })
            }
          })
        }
        // Folder-kind fallback (B2), mirroring switchTab step 4: with no
        // in-session folder cache, hydrateFromTab leaves folderFiles null,
        // which would drop the user on the Upload screen. Re-read the
        // directory from the persisted handle instead.
        if (target.kind === 'folder' && get().folderFiles === null) {
          void get().reopenFolderTab(target.id)
        }
      }
    }
  },
  switchTab: (id) => {
    const { tabs, activeTabId } = get()
    if (id === activeTabId) return
    const target = tabs.find((t) => t.id === id)
    if (!target) return
    // 1. Snapshot current singulars into the leaving tab
    const updatedTabs = tabs.map((t) => {
      if (t.id !== activeTabId) return t
      return snapshotIntoTab(t, get())
    })
    // 2. Hydrate the target's snapshot into singulars
    set({
      tabs: updatedTabs.map((t) => t.id === id ? { ...t, lastAccessedAt: Date.now() } : t),
      activeTabId: id,
      ...hydrateFromTab(target),
    })
    // 3. File-kind cross-reload restoration: in-memory fileBodyCache is empty
    // after a hard reload. Fall back to the persisted tabContent row.
    if (target.kind === 'file' && target.contentKey && !fileBodyCache.has(id)) {
      void getTabContent(target.contentKey).then((row) => {
        if (row && get().activeTabId === id) {
          fileBodyCache.set(id, row.body)
          set({ markdown: row.body })
        }
      })
    }
    // 4. Folder-kind cross-reload restoration: the directory handle and file
    // contents are per-session (a FileSystemDirectoryHandle can't be hydrated
    // synchronously from persistence). After a reload the folderBodyCache is
    // empty, so hydrateFromTab leaves folderFiles null — which would otherwise
    // drop the user on the Upload screen. Re-read the directory from the
    // persisted handle so clicking a folder tab returns to that folder.
    if (target.kind === 'folder' && get().folderFiles === null) {
      void get().reopenFolderTab(id)
    }
  },

  reopenFolderTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'folder') return
    // Caller guarantees the tab is active; openInCurrentTab targets the active tab.
    if (get().activeTabId !== tabId) return
    const label = tab.folderName ?? tab.title ?? 'folder'
    const fail = (why: string) =>
      showToast(`Couldn't reopen "${label}" — ${why}`, { durationMs: 4000 })
    if (!tab.handleKey) { fail('its folder reference is unavailable. Re-open it from the Open menu.'); return }
    const handle = await getHandle(tab.handleKey)
    if (!handle) { fail('the folder reference was lost. Re-open it from the Open menu.'); return }
    // Bail if the user switched away while the (async) handle lookup ran.
    if (get().activeTabId !== tabId) return
    // Remember which file was open so we can return to it (openInCurrentTab
    // resets the active file to the folder's first entry).
    const prevActiveFile = tab.activeFilePath ?? null
    try {
      const rawFiles = await reopenDirectory(handle)
      if (get().activeTabId !== tabId) return
      get().openInCurrentTab({
        kind: 'folder',
        folderName: label,
        handle,
        files: rawFiles.map((f) => ({
          path: f.path,
          name: f.path.split('/').pop() ?? f.path,
          content: f.content,
          lastModified: f.lastModified,
        })),
      })
      // Restore the previously-viewed file within the folder. setActiveFile
      // no-ops when the path no longer exists (file moved/deleted), so we
      // gracefully fall back to the first file in that case.
      if (prevActiveFile) get().setActiveFile(prevActiveFile)
    } catch {
      // reopenDirectory throws on denied permission or when the directory is
      // gone/moved — exactly the "flash an error" case.
      fail('it may have been moved or access was denied.')
    }
  },

  openInCurrentTab: (payload) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === activeTabId)
    if (idx < 0) { get().openInNewTab(payload); return }
    const updated = applyPayloadToTab(tabs[idx], payload)
    const nextTabs = tabs.slice()
    nextTabs[idx] = updated
    const extras = payloadToSingulars(payload)
    set({ tabs: nextTabs, ...extras })
    // Sync the in-session body caches so a subsequent switch-away/back round-trip
    // can hydrate without losing content.
    if (payload.kind === 'folder') {
      folderBodyCache.set(updated.id, {
        folderFiles: extras.folderFiles ?? null,
        folderFileContents: extras.folderFileContents ?? null,
      })
      fileBodyCache.delete(updated.id)
      tabChatCache.delete(updated.id)
    } else {
      fileBodyCache.set(updated.id, payload.content)
      folderBodyCache.delete(updated.id)
      tabChatCache.delete(updated.id)
    }
    void persistPayload(updated, payload)
  },

  openInNewTab: (payload) => {
    const { tabs, activeTabId } = get()
    const fresh = emptyTab()
    const populated = applyPayloadToTab(fresh, payload)
    // Snapshot current active tab before switching
    const updatedExisting = tabs.map((t) => t.id === activeTabId
      ? snapshotIntoTab(t, get())
      : t,
    )
    const extras = payloadToSingulars(payload)
    set({
      tabs: [...updatedExisting, populated],
      activeTabId: populated.id,
      ...extras,
    })
    // Prime the in-session body caches for the new tab so a later
    // snapshot/hydrate round-trip recovers what the user is seeing now.
    if (payload.kind === 'folder') {
      folderBodyCache.set(populated.id, {
        folderFiles: extras.folderFiles ?? null,
        folderFileContents: extras.folderFileContents ?? null,
      })
    } else {
      fileBodyCache.set(populated.id, payload.content)
    }
    void persistPayload(populated, payload)
  },

  openSmart: (payload) => {
    const { tabs, activeTabId } = get()
    const decision = decideOpen(tabs, activeTabId, payload)
    if (decision.action === 'focus') {
      if (decision.tabId !== activeTabId) {
        get().switchTab(decision.tabId)
      } else {
        // Already on the matching tab — refresh its content in place.
        get().openInCurrentTab(payload)
      }
      return
    }
    if (decision.action === 'fill') {
      if (decision.tabId !== activeTabId) get().switchTab(decision.tabId)
      get().openInCurrentTab(payload)
      return
    }
    get().openInNewTab(payload)
  },

  setActiveFile: (path) => {
    if (path === null) {
      const { tabs: curTabs, activeTabId } = get()
      set({
        activeFilePath: null, markdown: '', fileName: null,
        tabs: curTabs.map((t) =>
          t.id === activeTabId && t.kind === 'folder'
            ? { ...t, activeFilePath: null }
            : t,
        ),
      })
      return
    }
    const contents = get().folderFileContents
    if (!contents?.has(path)) return  // no-op for unknown path
    const file = get().folderFiles?.find(f => f.path === path)
    const { tabs: curTabs, activeTabId } = get()
    set({
      activeFilePath: path,
      markdown: contents.get(path) ?? '',
      fileName: file?.name ?? path,
      tabs: curTabs.map((t) =>
        t.id === activeTabId && t.kind === 'folder'
          ? { ...t, activeFilePath: path }
          : t,
      ),
    })
    // Persist scoped by folder name so a reload restores the last-viewed file.
    // Also mark this file as viewed for the collection-completion banner.
    const folderKey = get().folderHandle?.name ?? '__cache__'
    // Auto-expand ancestor folders so the newly active file is visible even
    // if it lives in a collapsed branch.
    const ancestors = ancestorDirs(path)
    if (ancestors.length) {
      const expanded = new Set(get().folderExpandedDirs)
      let grew = false
      for (const d of ancestors) if (!expanded.has(d)) { expanded.add(d); grew = true }
      if (grew) {
        const dirs = [...expanded]
        saveExpandedDirs(folderKey, dirs)
        set({ folderExpandedDirs: dirs })
      }
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`md-reader-active-file:${folderKey}`, path)
        const viewedKey = `md-reader-viewed-files:${folderKey}`
        let viewed: Record<string, boolean> = {}
        try { viewed = JSON.parse(localStorage.getItem(viewedKey) ?? '{}') } catch { /* ignore */ }
        if (!viewed[path]) {
          viewed[path] = true
          localStorage.setItem(viewedKey, JSON.stringify(viewed))
        }
      } catch { /* quota exceeded — non-fatal */ }
    }
  },

  closeFolderSession: () => {
    set({
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      sidebarExpandedFile: null,
      folderExpandedDirs: [],
      folderManualOrder: {},
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

  setFolderSortMode: (mode) => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('md-reader-folder-sort', mode) } catch { /* quota */ }
    }
    // Selecting a named sort clears any manual drag-order.
    if (mode !== 'custom') {
      const folderKey = get().folderHandle?.name ?? '__cache__'
      saveManualOrder(folderKey, {})
      set({ folderSortMode: mode, folderManualOrder: {} })
    } else {
      set({ folderSortMode: mode })
    }
  },

  toggleFolderDir: (path) => {
    const folderKey = get().folderHandle?.name ?? '__cache__'
    const cur = new Set(get().folderExpandedDirs)
    if (cur.has(path)) cur.delete(path); else cur.add(path)
    const dirs = [...cur]
    saveExpandedDirs(folderKey, dirs)
    set({ folderExpandedDirs: dirs })
  },

  setFolderManualOrder: (dir, order) => {
    const folderKey = get().folderHandle?.name ?? '__cache__'
    const next = { ...get().folderManualOrder, [dir]: order }
    saveManualOrder(folderKey, next)
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('md-reader-folder-sort', 'custom') } catch { /* quota */ }
    }
    // A drag implies custom order from now on.
    set({ folderManualOrder: next, folderSortMode: 'custom' })
  },

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

  hydrateFolderFromCache: async () => {
    // Guard against clobbering an explicit deeplink (extension push, share URL,
    // MCP file route, or repo browser). Deeplink handlers in App.tsx will
    // populate the active tab with the user's intended target — silently
    // hydrating a cached folder on top would race them.
    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      if (
        hash.startsWith('#md=') ||
        hash.startsWith('#url=') ||
        hash.startsWith('#repo=') ||
        hash.startsWith('#file=') ||
        hash === '#ext-pending'
      ) {
        return
      }
    }
    if (get().folderFiles !== null) return  // already hydrated
    const { getCollectionCache } = await import('../lib/docstore')
    const cache = await getCollectionCache()
    if (!cache || cache.files.length === 0) return
    const files = cache.files.map(f => ({
      path: f.path,
      name: f.path.split('/').pop() ?? f.path,
      content: f.content,
    }))
    // Migrate legacy viewedFiles from index-keyed to path-keyed format.
    // Old: md-reader-collection-viewed-<name> → number[]  (indices into file list)
    // New: md-reader-viewed-files:<name>     → Record<string, boolean>
    // Installed by CollectionReader pre-refactor; surviving users should
    // keep their read-markers across the unified view migration.
    const legacyKey = `md-reader-collection-viewed-${cache.name}`
    const newKey = `md-reader-viewed-files:${cache.name}`
    const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem(legacyKey) : null
    if (legacy) {
      try {
        const indices: number[] = JSON.parse(legacy)
        const pathMap: Record<string, boolean> = {}
        for (const i of indices) {
          if (cache.files[i]) pathMap[cache.files[i].path] = true
        }
        localStorage.setItem(newKey, JSON.stringify(pathMap))
        localStorage.removeItem(legacyKey)
      } catch {
        // Corrupt legacy data — just drop it
        localStorage.removeItem(legacyKey)
      }
    }
    get().setFolderSession(null, files)
  },

  // Re-read the currently-open folder from disk using the stored
  // FileSystemDirectoryHandle. Requires user to have granted the live
  // handle (not the IndexedDB cache path). Preserves the active file
  // selection if it still exists on disk.
  refreshFolder: async () => {
    const handle = get().folderHandle
    if (!handle) return { ok: false as const, reason: 'No live folder handle — reopen the folder to refresh.' }
    try {
      const { reopenDirectory } = await import('../lib/fs-access')
      const files = await reopenDirectory(handle)
      const prevFiles = get().folderFiles ?? []
      const prevContents = get().folderFileContents ?? new Map<string, string>()
      const prevActive = get().activeFilePath

      const prevPaths = new Set(prevFiles.map(f => f.path))
      const newPaths = new Set(files.map(f => f.path))
      let added = 0, changed = 0, removed = 0
      for (const f of files) {
        if (!prevPaths.has(f.path)) added++
        else if (prevContents.get(f.path) !== f.content) changed++
      }
      for (const p of prevPaths) if (!newPaths.has(p)) removed++

      // Persist cache so reload-after-refresh stays fresh.
      try {
        const { saveCollectionCache } = await import('../lib/docstore')
        const rawFiles = files.map(f => ({ path: f.path, content: f.content }))
        await saveCollectionCache(handle.name, rawFiles, 0)
      } catch { /* cache write is best-effort */ }

      const mapped = files.map(f => ({
        path: f.path,
        name: f.path.split('/').pop() ?? f.path,
        content: f.content,
        lastModified: f.lastModified,
      }))
      get().setFolderSession(handle, mapped)
      // Prefer keeping the previously active file if it still exists.
      if (prevActive && newPaths.has(prevActive)) {
        get().setActiveFile(prevActive)
      }
      return { ok: true as const, added, changed, removed }
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message || 'Failed to re-read folder' }
    }
  },

  remoteShare: null,
  setRemoteShare: (value) => set({ remoteShare: value }),
}), {
  name: 'md-reader-session',
  // In iframe mode (e.g. JupyterLab embedding), disable persistence entirely:
  //   * the host re-pushes the active document via SET_MARKDOWN on every
  //     panel construction, so caching `markdown`/`fileName`/`toc` to IDB
  //     just creates a stale-state hazard;
  //   * a single user opening the same `.md` file in two JL tabs would
  //     otherwise clobber a single IDB row in last-writer-wins fashion;
  //   * chat history, view mode, and reading progress are all doc-scoped,
  //     and we'd rather they reset on reload than restore against the
  //     wrong doc.
  // The standalone site keeps full IDB persistence — only the iframe path
  // routes through the noop adapter.
  //
  // Security: this runtime check is defense-in-depth, NOT the primary trust
  // boundary. The real iframe-vs-host guarantee comes from origin pinning
  // in `src/lib/iframe-bridge.ts` (`parentOrigin` check at onWindowMessage)
  // — a hostile parent that suppressed this noop adapter still couldn't
  // post messages without passing the origin pin first.
  storage: (typeof window !== 'undefined' && window.parent !== window)
    ? {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      getItem: async (_name) => null,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setItem: async (_name, _value) => { /* noop in iframe mode */ },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      removeItem: async (_name) => { /* noop in iframe mode */ },
    }
    : {
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
    // When running embedded in a host iframe (e.g. JupyterLab), the host
    // pushes the active document via SET_MARKDOWN. The persisted store
    // from a *prior* iframe session belongs to a *prior* document — keeping
    // it lets the iframe render the wrong file. Trust `current` (the live
    // in-memory state) over `persisted` for doc-shaped fields: `current` is
    // either empty (host hasn't sent yet) or already set by the SET_MARKDOWN
    // handler in main.tsx if its postMessage raced ahead of hydration.
    const isIframe = typeof window !== 'undefined' && window.parent !== window
    if (isIframe) {
      // Defence-in-depth: even though the noop storage adapter above means
      // `merge` should never see a persisted iframe state in practice, if
      // persistence is ever partially re-enabled (e.g. settings-only) we
      // still want to refuse to restore doc-scoped fields. Chat messages
      // are doc-scoped too — restoring a prior doc's chat against a freshly
      // pushed SET_MARKDOWN would attribute the old conversation to the
      // wrong file.
      merged.markdown = current.markdown
      merged.fileName = current.fileName
      merged.toc = current.toc
      merged.readingProgress = current.readingProgress
      merged.activeSection = current.activeSection
      merged.activeDocId = current.activeDocId
      merged.chatMessages = []
    }
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
    // Deep-link into a folder file (`#read?f=…`): clear the persisted single-doc
    // markdown/fileName so folder hydration + URL-driven file restoration can
    // populate them, instead of being overridden by a stale "View all as one"
    // merged doc that happened to be cached.
    if (/[?&]f=/.test(hash)) {
      merged.markdown = ''
      merged.fileName = null
      merged.toc = []
      merged.readingProgress = 0
      merged.activeSection = null
    }
    // Legacy hydration: if persisted state has no tabs array but does have
    // a document loaded, synthesize a single file tab so the UI always has
    // at least one tab to render after upgrading from a pre-tabs version.
    const mergedAny = merged as unknown as DocumentState
    if ((!mergedAny.tabs || mergedAny.tabs.length === 0) && mergedAny.markdown && mergedAny.fileName) {
      const synth = emptyTab()
      synth.kind = 'file'
      synth.title = mergedAny.fileName
      synth.fileName = mergedAny.fileName
      synth.viewMode = mergedAny.viewMode ?? 'read'
      mergedAny.tabs = [synth]
      mergedAny.activeTabId = synth.id
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
    tabs: state.tabs,
    activeTabId: state.activeTabId,
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
