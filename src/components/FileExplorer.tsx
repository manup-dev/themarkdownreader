import { useCallback, useMemo, useState } from 'react'
import { FolderOpen, X, ChevronRight, ChevronDown, Link as LinkIcon, ArrowRight, ArrowLeft, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useActiveSection, type Heading } from '../hooks/useActiveSection'

/**
 * Sidebar file tree for folder-browsing mode. Renders folderFiles from
 * Zustand, highlights the active file, and lets the user click to
 * switch. The active file's row can be expanded inline to show its
 * outline (headings), collapsed by default.
 *
 * Also contains a "Links" collapsible section below the file tree
 * showing forward-links and backlinks for the current active file,
 * computed on the fly from folderFileContents.
 *
 * Replaces the file list + backlinks sidebar that used to live inside
 * CollectionReader.tsx. See docs/superpowers/specs/2026-04-15-unified-
 * directory-file-view-design.md
 */

// Simple markdown link extractor: matches [text](./path.md) and variants.
// Scoped to markdown links only — ignores HTML anchors and external URLs.
function extractMarkdownLinks(content: string): string[] {
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const href = m[1]
    // Filter: only relative .md links (skip http, mailto, #anchor)
    if (/^(https?:|mailto:|#)/i.test(href)) continue
    if (!/\.md(#|$)/i.test(href)) continue
    // Strip fragment
    const clean = href.split('#')[0]
    out.push(clean)
  }
  return out
}

// Resolve a relative link against the linking file's directory.
// Returns the normalized path (matching folderFiles path keys) or null
// if the target can't be resolved.
function resolveLink(fromPath: string, href: string, allPaths: Set<string>): string | null {
  const fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : ''
  let target = href.replace(/^\.\//, '')
  if (target.startsWith('../')) {
    const parts = fromDir.split('/').filter(Boolean)
    while (target.startsWith('../')) {
      parts.pop()
      target = target.slice(3)
    }
    target = parts.length > 0 ? `${parts.join('/')}/${target}` : target
  } else if (!target.startsWith('/') && fromDir) {
    target = `${fromDir}/${target}`
  }
  target = target.replace(/^\//, '')
  return allPaths.has(target) ? target : null
}

export function FileExplorer() {
  const folderFiles = useStore(s => s.folderFiles)
  const folderFileContents = useStore(s => s.folderFileContents)
  const activeFilePath = useStore(s => s.activeFilePath)
  const sidebarExpandedFile = useStore(s => s.sidebarExpandedFile)
  const folderHandle = useStore(s => s.folderHandle)
  const setActiveFile = useStore(s => s.setActiveFile)
  const setSidebarExpandedFile = useStore(s => s.setSidebarExpandedFile)
  const closeFolderSession = useStore(s => s.closeFolderSession)
  const refreshFolder = useStore(s => s.refreshFolder)
  const toc = useStore(s => s.toc)

  const [linksOpen, setLinksOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshToast, setRefreshToast] = useState<string | null>(null)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const result = await refreshFolder()
      if (result.ok) {
        const parts: string[] = []
        if (result.added) parts.push(`+${result.added} added`)
        if (result.changed) parts.push(`${result.changed} changed`)
        if (result.removed) parts.push(`-${result.removed} removed`)
        setRefreshToast(parts.length ? parts.join(', ') : 'Up to date')
      } else {
        setRefreshToast(result.reason)
      }
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshToast(null), 2800)
    }
  }, [refreshing, refreshFolder])

  // Normalize toc → Heading[] for the hook
  const headings: Heading[] = toc.map(h => ({ id: h.id, text: h.text, level: h.level }))
  const activeSectionId = useActiveSection(headings)

  // Compute link graph on the fly. Memoized by folderFiles identity.
  const linkGraph = useMemo(() => {
    if (!folderFiles || !folderFileContents) {
      return { forward: new Map<string, string[]>(), backward: new Map<string, string[]>() }
    }
    const allPaths = new Set(folderFiles.map(f => f.path))
    const forward = new Map<string, string[]>()
    const backward = new Map<string, string[]>()
    for (const file of folderFiles) {
      const content = folderFileContents.get(file.path) ?? ''
      const hrefs = extractMarkdownLinks(content)
      const resolved: string[] = []
      for (const h of hrefs) {
        const target = resolveLink(file.path, h, allPaths)
        if (target && target !== file.path) {
          resolved.push(target)
          if (!backward.has(target)) backward.set(target, [])
          backward.get(target)!.push(file.path)
        }
      }
      forward.set(file.path, resolved)
    }
    return { forward, backward }
  }, [folderFiles, folderFileContents])

  const handleFileClick = useCallback((path: string) => {
    if (activeFilePath !== path) {
      setActiveFile(path)
      setSidebarExpandedFile(null)  // collapse any previously expanded
    } else {
      // Clicking the active file toggles its outline
      setSidebarExpandedFile(sidebarExpandedFile === path ? null : path)
    }
  }, [activeFilePath, sidebarExpandedFile, setActiveFile, setSidebarExpandedFile])

  const handleHeadingClick = useCallback((id: string) => {
    if (!id) return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (!folderFiles) {
    return (
      <div className="px-4 py-6 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Open a folder to browse markdown files here.
        </p>
      </div>
    )
  }

  if (folderFiles.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No markdown files in this folder.
        </p>
      </div>
    )
  }

  const currentForward = activeFilePath ? (linkGraph.forward.get(activeFilePath) ?? []) : []
  const currentBackward = activeFilePath ? (linkGraph.backward.get(activeFilePath) ?? []) : []
  const hasLinks = currentForward.length > 0 || currentBackward.length > 0

  return (
    <nav aria-label="Folder contents" className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Folder
        </h3>
        <div className="flex items-center gap-1">
          {folderHandle && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh folder from disk"
              title={refreshing ? 'Refreshing…' : 'Refresh from disk'}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
            >
              <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} />
            </button>
          )}
          <button
            type="button"
            onClick={closeFolderSession}
            aria-label="Close folder"
            title="Close folder"
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      {refreshToast && (
        <div className="px-4 py-1 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-700 shrink-0">
          {refreshToast}
        </div>
      )}

      <ul className="flex-1 overflow-y-auto py-1 min-h-0">
        {folderFiles.map((file) => {
          const isActive = activeFilePath === file.path
          const isExpanded = sidebarExpandedFile === file.path
          return (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => handleFileClick(file.path)}
                aria-current={isActive ? 'true' : undefined}
                className={
                  'flex items-center gap-1 w-full text-left text-sm px-3 py-1 transition-colors ' +
                  (isActive
                    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')
                }
              >
                {isActive
                  ? (isExpanded
                      ? <ChevronDown className="h-3 w-3 shrink-0" />
                      : <ChevronRight className="h-3 w-3 shrink-0" />)
                  : <span className="w-3 shrink-0" />}
                <span className="truncate">{file.name}</span>
              </button>
              {isActive && isExpanded && headings.length > 0 && (
                <ul className="mb-1 pl-4 border-l border-gray-200 dark:border-gray-700 ml-4">
                  {headings.map((h, idx) => (
                    <li key={`${h.id}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => handleHeadingClick(h.id)}
                        style={{ paddingLeft: `${(h.level - 1) * 0.6}rem` }}
                        className={
                          'block w-full text-left text-xs py-0.5 pr-2 hover:bg-gray-100 dark:hover:bg-gray-800 ' +
                          (activeSectionId === h.id
                            ? 'text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-gray-500 dark:text-gray-400')
                        }
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {/* Links panel — collapsible, only shows if there are links */}
      {hasLinks && activeFilePath && (
        <div className="border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            type="button"
            onClick={() => setLinksOpen(v => !v)}
            aria-expanded={linksOpen}
            className="flex items-center gap-1 w-full px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {linksOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <LinkIcon className="h-3 w-3" />
            <span>Links</span>
            <span className="ml-auto text-[10px] font-normal">
              {currentForward.length + currentBackward.length}
            </span>
          </button>
          {linksOpen && (
            <div className="pb-2">
              {currentForward.length > 0 && (
                <div className="px-4 py-1">
                  <p className="text-[10px] uppercase text-gray-400 dark:text-gray-500 mb-0.5 flex items-center gap-1">
                    <ArrowRight className="h-2.5 w-2.5" /> Links to
                  </p>
                  <ul>
                    {currentForward.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => handleFileClick(p)}
                          className="block w-full text-left text-xs py-0.5 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate"
                        >
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {currentBackward.length > 0 && (
                <div className="px-4 py-1">
                  <p className="text-[10px] uppercase text-gray-400 dark:text-gray-500 mb-0.5 flex items-center gap-1">
                    <ArrowLeft className="h-2.5 w-2.5" /> Referenced by
                  </p>
                  <ul>
                    {currentBackward.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => handleFileClick(p)}
                          className="block w-full text-left text-xs py-0.5 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate"
                        >
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
