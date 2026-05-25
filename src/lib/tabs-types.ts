// src/lib/tabs-types.ts
import type { ViewMode } from '../store/useStore'

export type TabKind = 'folder' | 'file' | 'empty'

export interface Tab {
  id: string
  kind: TabKind
  title: string
  viewMode: ViewMode
  scrollProgress: number
  createdAt: number
  lastAccessedAt: number
  // folder-kind
  folderName?: string
  handleKey?: string
  activeFilePath?: string | null
  // file-kind
  fileName?: string
  contentKey?: string
}

export type TabPayload =
  | {
      kind: 'folder'
      folderName: string
      handle: FileSystemDirectoryHandle | null
      files: Array<{ path: string; name: string; content: string; lastModified?: number }>
    }
  | { kind: 'file'; fileName: string; content: string }

export function newTabId(): string {
  // crypto.randomUUID is available in all evergreen browsers + jsdom 22+
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyTab(): Tab {
  const now = Date.now()
  return {
    id: newTabId(),
    kind: 'empty',
    title: 'Untitled',
    viewMode: 'read',
    scrollProgress: 0,
    createdAt: now,
    lastAccessedAt: now,
  }
}
