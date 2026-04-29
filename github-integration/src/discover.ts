import { readdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export interface SidecarPair {
  sourcePath: string
  sidecarPath: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])

/**
 * Walk `root` and pair each `.{stem}.annot` sidecar with its sibling `{stem}` source.
 * Orphan sidecars (no matching source) are dropped. Hidden directories and the
 * standard build/cache dirs are skipped to keep large repos cheap.
 */
export async function findSidecars(root: string): Promise<SidecarPair[]> {
  const out: SidecarPair[] = []
  await walk(root, out)
  return out
}

async function walk(dir: string, out: SidecarPair[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.') continue
      await walk(full, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.annot')) continue
    if (!entry.name.startsWith('.')) continue
    // Strip the leading dot and the trailing `.annot` to recover the source basename.
    const stem = entry.name.slice(1, -'.annot'.length)
    if (!stem) continue
    const sourcePath = join(dirname(full), stem)
    try {
      await access(sourcePath)
    } catch {
      continue // orphan
    }
    out.push({ sourcePath, sidecarPath: full })
  }
}
