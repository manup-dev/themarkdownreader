import type { FolderSortMode } from '../store/useStore'

export interface SortableFile {
  path: string
  name: string
  lastModified: number
}

/**
 * Sorts folder files in a stable, user-facing order. The default
 * `name-asc` uses locale-aware, numeric-aware comparison so filenames
 * with numeric prefixes (`00-intro.md`, `07-setup.md`, `08-notes.md`)
 * order the way humans expect instead of relying on whatever order the
 * File System Access API yielded.
 */
export function sortFolderFiles<T extends SortableFile>(
  files: readonly T[],
  mode: FolderSortMode,
): T[] {
  const arr = files.slice()
  switch (mode) {
    case 'name-asc':
      return arr.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
    case 'name-desc':
      return arr.sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
    case 'mtime-desc':
      return arr.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
    case 'mtime-asc':
      return arr.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0))
  }
}

export const folderSortLabels: Record<FolderSortMode, string> = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
  'mtime-desc': 'Modified (newest)',
  'mtime-asc': 'Modified (oldest)',
}
