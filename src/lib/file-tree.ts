import type { FolderSortMode } from '../store/useStore'
import { sortFolderFiles, type SortableFile } from './folder-sort'

/**
 * A node in the sidebar file tree. Either a leaf markdown `file` or a
 * `folder` containing more nodes. Built from the flat `folderFiles`
 * array by {@link buildFileTree} — no I/O, no React. Keeping it pure
 * means the nesting/sorting logic is unit-tested in isolation.
 *
 * The folder/file split is what disambiguates same-named entries: a
 * file `guide.md` and a sibling directory `guide/` become two distinct
 * nodes, and `docs/intro.md` vs `examples/intro.md` live under separate
 * folder parents instead of colliding as two bare `intro` rows.
 */
export type FileTreeNode =
  | { type: 'file'; path: string; name: string; lastModified: number }
  | { type: 'folder'; path: string; name: string; children: FileTreeNode[] }

/** Parent directory of a path, or '' for a root-level entry. */
export function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Ancestor dir paths of a file path, outermost first. 'a/b/c.md' → ['a','a/b']. */
export function ancestorDirs(path: string): string[] {
  const segs = path.split('/')
  segs.pop() // drop the filename
  const out: string[] = []
  let acc = ''
  for (const s of segs) {
    acc = acc ? `${acc}/${s}` : s
    out.push(acc)
  }
  return out
}

function nameCompare(a: string, b: string, desc: boolean): number {
  const r = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return desc ? -r : r
}

/**
 * Order a single level's children: folders first, then files. Folders
 * are always ordered by name (asc, or desc when the mode is name-desc);
 * files follow the full sort mode. For `custom`, both groups follow the
 * `manualOrder` list for this dir, with unlisted entries falling back to
 * name-asc so newly-added files land at the end deterministically.
 */
function sortLevel(
  nodes: FileTreeNode[],
  dirPath: string,
  mode: FolderSortMode,
  manualOrder?: Record<string, string[]>,
): FileTreeNode[] {
  const folders = nodes.filter((n): n is Extract<FileTreeNode, { type: 'folder' }> => n.type === 'folder')
  const files = nodes.filter((n): n is Extract<FileTreeNode, { type: 'file' }> => n.type === 'file')

  if (mode === 'custom') {
    const order = manualOrder?.[dirPath] ?? []
    const rank = (p: string) => {
      const i = order.indexOf(p)
      return i === -1 ? Number.POSITIVE_INFINITY : i
    }
    const byOrder = <T extends FileTreeNode>(arr: T[]) =>
      arr.slice().sort((a, b) => {
        const d = rank(a.path) - rank(b.path)
        return d !== 0 ? d : nameCompare(a.name, b.name, false)
      })
    return [...byOrder(folders), ...byOrder(files)]
  }

  const desc = mode === 'name-desc'
  const sortedFolders = folders.slice().sort((a, b) => nameCompare(a.name, b.name, desc))
  const sortedFiles = sortFolderFiles(files as SortableFile[], mode) as Extract<FileTreeNode, { type: 'file' }>[]
  return [...sortedFolders, ...sortedFiles]
}

/**
 * Build a nested folder/file tree from the flat `folderFiles` list.
 * Deterministic: same inputs always produce the same tree.
 */
export function buildFileTree(
  files: readonly SortableFile[],
  sortMode: FolderSortMode,
  manualOrder?: Record<string, string[]>,
): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const folderByPath = new Map<string, Extract<FileTreeNode, { type: 'folder' }>>()

  for (const file of files) {
    const segs = file.path.split('/')
    const fileName = segs.pop() as string
    let childrenList = root
    let accPath = ''
    for (const seg of segs) {
      accPath = accPath ? `${accPath}/${seg}` : seg
      let folder = folderByPath.get(accPath)
      if (!folder) {
        folder = { type: 'folder', path: accPath, name: seg, children: [] }
        folderByPath.set(accPath, folder)
        childrenList.push(folder)
      }
      childrenList = folder.children
    }
    childrenList.push({ type: 'file', path: file.path, name: fileName, lastModified: file.lastModified })
  }

  const sortRec = (nodes: FileTreeNode[], dirPath: string): FileTreeNode[] => {
    const ordered = sortLevel(nodes, dirPath, sortMode, manualOrder)
    for (const n of ordered) {
      if (n.type === 'folder') n.children = sortRec(n.children, n.path)
    }
    return ordered
  }

  return sortRec(root, '')
}

/** Flatten a tree into a `dirPath → child nodes` map (for sibling lookups). */
export function childrenByDir(tree: FileTreeNode[]): Map<string, FileTreeNode[]> {
  const map = new Map<string, FileTreeNode[]>()
  const walk = (nodes: FileTreeNode[], dir: string) => {
    map.set(dir, nodes)
    for (const n of nodes) if (n.type === 'folder') walk(n.children, n.path)
  }
  walk(tree, '')
  return map
}
