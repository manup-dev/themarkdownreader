/**
 * Folder-level intake for github-repo share URLs. Sibling to share-loader,
 * but produces a directory listing instead of a single materialized doc.
 */

import { defaultRemoteAdapter, type RemoteDocumentAdapter, type FolderEntry } from './remote-document'
import { parseShareUrl, buildGithubRepoShare, buildUrlPairShare } from './share-url'
import { fetchWorkspaceConfig, githubWorkspaceRootUrl, type WorkspaceConfig } from './workspace-config'

export interface RepoFolderResult {
  repo: { owner: string; name: string; ref: string; path: string }
  /** Files + sub-directories at this level. .md files are openable; dirs drill down. */
  entries: FolderEntry[]
  /** Workspace config from `.mdreader/config.json` if present. */
  config: WorkspaceConfig | null
  /** Pre-built share URL for each .md entry (Tier 2 url-pair, no annot). */
  shareUrls: Record<string, string>
  /** Pre-built nested-folder share URLs for each dir entry. */
  folderShareUrls: Record<string, string>
}

export interface LoadRepoFolderOptions {
  href?: string
  adapter?: RemoteDocumentAdapter
  origin?: string
}

/**
 * Returns null when the URL is not a github-repo share or the path looks
 * like a single .md doc (caller handles those via loadShareFromHash).
 */
export async function loadRepoFolderFromHash(opts: LoadRepoFolderOptions = {}): Promise<RepoFolderResult | null> {
  const adapter = opts.adapter ?? defaultRemoteAdapter()
  const href = opts.href ?? (typeof window !== 'undefined' ? window.location.href : '')
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '')

  const handle = parseShareUrl({ href })
  if (!handle || handle.kind !== 'github-repo' || !handle.repo) return null
  // Single-doc path is share-loader's job.
  if (handle.repo.path && handle.repo.path.endsWith('.md')) return null

  const entriesRaw = adapter.listFolder ? await adapter.listFolder(handle) : []

  // Sort: dirs first (alphabetical), then files (alphabetical). Pinned
  // files from the workspace config float to the top within their group.
  const config = await fetchWorkspaceConfig(githubWorkspaceRootUrl(handle.repo))
  const entries = sortEntries(entriesRaw, config?.pinned ?? [])

  const shareUrls: Record<string, string> = {}
  const folderShareUrls: Record<string, string> = {}
  for (const e of entries) {
    if (e.type === 'file') {
      shareUrls[e.path] = buildUrlPairShare({ origin, docUrl: e.url })
    } else {
      folderShareUrls[e.path] = buildGithubRepoShare({
        origin,
        owner: handle.repo.owner,
        name: handle.repo.name,
        path: e.path,
        ref: handle.repo.ref,
      })
    }
  }

  return {
    repo: handle.repo,
    entries,
    config,
    shareUrls,
    folderShareUrls,
  }
}

function sortEntries(entries: FolderEntry[], pinned: string[]): FolderEntry[] {
  const pinnedSet = new Set(pinned)
  const dirs = entries.filter((e) => e.type === 'dir')
  const files = entries.filter((e) => e.type === 'file')
  const pinnedFirst = (a: FolderEntry, b: FolderEntry) => {
    const aPinned = pinnedSet.has(a.path)
    const bPinned = pinnedSet.has(b.path)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return a.name.localeCompare(b.name)
  }
  dirs.sort(pinnedFirst)
  files.sort(pinnedFirst)
  return [...dirs, ...files]
}
