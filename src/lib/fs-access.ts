/**
 * File System Access API wrapper.
 * Opens a directory picker, reads all .md files recursively, and maintains a handle
 * for future re-reads (like a symlink — persists across sessions via IndexedDB).
 *
 * Falls back to <input webkitdirectory> for older browsers.
 */

// Augment FileSystemDirectoryHandle for browsers that support it
interface FSHandle extends FileSystemDirectoryHandle {
  requestPermission(opts: { mode: string }): Promise<string>
  values(): AsyncIterableIterator<FileSystemHandle & { kind: string; name: string }>
}

export interface DirectoryFile {
  path: string
  content: string
  lastModified: number
}

/**
 * Open a directory picker and read all markdown files.
 * Returns the files and a handle that can be stored for re-access.
 */
export async function openDirectory(): Promise<{
  name: string
  files: DirectoryFile[]
  handle: FileSystemDirectoryHandle
} | null> {
  if (!('showDirectoryPicker' in window)) {
    return null // Use fallback
  }

  try {
    const handle = await (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
      mode: 'read',
    })

    const files = await readDirectoryRecursive(handle, '')
    return { name: handle.name, files, handle }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null // User cancelled
    throw e
  }
}

/**
 * Re-read a previously opened directory using a stored handle.
 * Requires permission re-grant on new sessions.
 */
export async function reopenDirectory(handle: FileSystemDirectoryHandle): Promise<DirectoryFile[]> {
  // Request permission if needed
  const permission = await (handle as unknown as FSHandle).requestPermission({ mode: 'read' })
  if (permission !== 'granted') {
    throw new Error('Permission denied. Please grant read access.')
  }

  return readDirectoryRecursive(handle, '')
}

/**
 * Recursively read all .md/.markdown files from a directory handle.
 */
async function readDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
): Promise<DirectoryFile[]> {
  const files: DirectoryFile[] = []

  for await (const entry of (dirHandle as unknown as FSHandle).values()) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name

    if (entry.kind === 'file' && /\.(md|markdown|excalidraw)$/i.test(entry.name)) {
      const fileHandle = entry as FileSystemFileHandle
      const file = await fileHandle.getFile()
      const content = await file.text()
      files.push({
        path: entryPath,
        content,
        lastModified: file.lastModified,
      })
    } else if (entry.kind === 'directory') {
      // Skip hidden directories and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
      const subDir = entry as FileSystemDirectoryHandle
      const subFiles = await readDirectoryRecursive(subDir, entryPath)
      files.push(...subFiles)
    }
  }

  return files
}

/**
 * Watch a directory for changes (poll-based, since File System Observer API is not widely available).
 */
export async function watchDirectory(
  handle: FileSystemDirectoryHandle,
  onChanged: (files: DirectoryFile[]) => void,
  intervalMs = 5000,
): Promise<() => void> {
  let lastSnapshot = new Map<string, number>()

  // Initial snapshot
  const initial = await readDirectoryRecursive(handle, '')
  for (const f of initial) {
    lastSnapshot.set(f.path, f.lastModified)
  }

  const timer = setInterval(async () => {
    try {
      const current = await readDirectoryRecursive(handle, '')
      const currentMap = new Map(current.map((f) => [f.path, f.lastModified]))

      // Check for changes
      let changed = false
      if (currentMap.size !== lastSnapshot.size) changed = true
      for (const [path, modified] of currentMap) {
        if (lastSnapshot.get(path) !== modified) { changed = true; break }
      }

      if (changed) {
        lastSnapshot = currentMap
        onChanged(current)
      }
    } catch {
      // Directory may have been deleted or permission revoked
      clearInterval(timer)
    }
  }, intervalMs)

  return () => clearInterval(timer)
}

/**
 * Resolve a relative image reference (e.g. `./img/diagram.png`, `assets/logo.png`,
 * `/logo.png`) against a directory handle and return an object URL for the image
 * file, or null if it can't be found. Used to render images that live alongside
 * markdown in a picked folder — the browser can't load `file://`-style relatives.
 *
 * `currentFilePath` is the folder-relative path of the markdown being viewed; the
 * image is resolved relative to that file's directory (root-relative `/x` resolves
 * from the folder root). Caller owns the returned URL and must revokeObjectURL it.
 */
export async function resolveImageBlobUrl(
  handle: FileSystemDirectoryHandle,
  currentFilePath: string,
  imgSrc: string,
): Promise<string | null> {
  const clean = imgSrc.split('#')[0].split('?')[0]
  if (!clean) return null

  const fileDir = currentFilePath.includes('/')
    ? currentFilePath.slice(0, currentFilePath.lastIndexOf('/'))
    : ''
  const joined = clean.startsWith('/')
    ? clean.slice(1)
    : fileDir ? `${fileDir}/${clean}` : clean

  // Normalize `.`/`..` segments.
  const segments: string[] = []
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { segments.pop(); continue }
    segments.push(decodeURIComponent(seg))
  }
  if (segments.length === 0) return null

  try {
    let dir = handle as unknown as {
      getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>
      getFileHandle(name: string): Promise<FileSystemFileHandle>
    }
    for (let i = 0; i < segments.length - 1; i++) {
      dir = (await dir.getDirectoryHandle(segments[i])) as never
    }
    const fileHandle = await dir.getFileHandle(segments[segments.length - 1])
    const file = await fileHandle.getFile()
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

/**
 * Check if File System Access API is supported.
 */
export function hasDirectoryAccess(): boolean {
  return 'showDirectoryPicker' in window
}

/**
 * Fallback: read files from a <input webkitdirectory> file list.
 */
export function readFileList(files: FileList): Promise<DirectoryFile[]> {
  return Promise.all(
    Array.from(files)
      .filter((f) => /\.(md|markdown|excalidraw)$/i.test(f.name))
      .map(async (f) => ({
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        content: await f.text(),
        lastModified: f.lastModified,
      })),
  )
}
