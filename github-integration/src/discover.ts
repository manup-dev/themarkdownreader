import { readdir, access, stat as fsStat } from 'node:fs/promises'
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
 * Symlinks are followed; directory symlinks are cycle-guarded by real inode.
 */
export async function findSidecars(root: string): Promise<SidecarPair[]> {
  const out: SidecarPair[] = []
  const visited = new Set<string>()
  try {
    const rootStat = await fsStat(root)
    visited.add(`${rootStat.dev}:${rootStat.ino}`)
  } catch {
    return out // root doesn't exist
  }
  await walk(root, out, visited)
  return out
}

async function walk(dir: string, out: SidecarPair[], visited = new Set<string>()): Promise<void> {
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)

    // Resolve the entry's real type, following symlinks.
    let isDir = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        const s = await fsStat(full) // follows the link
        isDir = s.isDirectory()
        isFile = s.isFile()
        // Cycle guard: skip if we've already entered this real path.
        const real = `${s.dev}:${s.ino}`
        if (isDir) {
          if (visited.has(real)) continue
          visited.add(real)
        }
      } catch {
        continue // dangling symlink
      }
    } else if (isDir) {
      // Track real directory inodes too so symlinks to them are cycle-detected.
      try {
        const s = await fsStat(full)
        const real = `${s.dev}:${s.ino}`
        visited.add(real)
      } catch {
        // ignore — if stat fails we still walk it
      }
    }

    if (isDir) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      await walk(full, out, visited)
      continue
    }
    if (!isFile) continue
    if (!entry.name.endsWith('.annot')) continue
    if (!entry.name.startsWith('.')) continue
    // Strip the leading dot and the trailing `.annot` to recover the source basename.
    const stem = entry.name.slice(1, -'.annot'.length)
    if (!stem) continue
    const sourcePath = join(dirname(full), stem)
    try { await access(sourcePath) } catch { continue }
    out.push({ sourcePath, sidecarPath: full })
  }
}
