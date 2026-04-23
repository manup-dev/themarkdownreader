/**
 * Optional `.mdreader/config.json` at a workspace/repo root carries
 * collection-wide defaults. All fields are optional; absence of the file
 * itself is fine and just means "use reasonable defaults".
 *
 * See design doc 03-storage-topology.md for the bundle layout.
 */

import { ensureSafeFetchUrl } from './share-url'

export interface WorkspaceConfig {
  /** Display name for the collection (shown in the sidebar header). */
  displayName?: string
  /** Default author/handle to apply to new annotations made in this workspace. */
  defaultAuthor?: string
  /** Optional ordered list of paths to feature in the sidebar. */
  pinned?: string[]
  /** Free-form tag vocabulary for future tag UX. */
  tags?: string[]
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 64 * 1024

/**
 * Fetch the workspace config from `<base>/.mdreader/config.json`. Missing
 * file → null, malformed file → null with a console warn (don't block the
 * collection from rendering on a typo).
 */
export async function fetchWorkspaceConfig(baseUrl: string): Promise<WorkspaceConfig | null> {
  let normalized: string
  try {
    const u = new URL(baseUrl)
    if (!u.pathname.endsWith('/')) u.pathname += '/'
    normalized = u.toString() + '.mdreader/config.json'
  } catch {
    return null
  }
  const safe = ensureSafeFetchUrl(normalized)
  if (!safe.ok) return null
  try {
    const res = await fetch(safe.url!, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const lenHeader = res.headers.get('content-length')
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) return null
    const text = await res.text()
    const parsed = JSON.parse(text) as unknown
    return validateConfig(parsed)
  } catch (e) {
    console.warn('[md-reader] failed to load workspace config', e)
    return null
  }
}

function validateConfig(input: unknown): WorkspaceConfig | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const cfg: WorkspaceConfig = {}
  if (typeof obj.displayName === 'string') cfg.displayName = obj.displayName
  if (typeof obj.defaultAuthor === 'string') cfg.defaultAuthor = obj.defaultAuthor
  if (Array.isArray(obj.pinned)) cfg.pinned = obj.pinned.filter((p): p is string => typeof p === 'string')
  if (Array.isArray(obj.tags)) cfg.tags = obj.tags.filter((t): t is string => typeof t === 'string')
  return cfg
}

/**
 * Compose the URL of a workspace's root for a github-repo handle. Used by
 * the repo browser to derive the config URL.
 */
export function githubWorkspaceRootUrl(repo: { owner: string; name: string; ref: string }): string {
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.ref}/`
}
