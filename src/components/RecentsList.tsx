import { useEffect, useState, useCallback } from 'react'
import { Folder, FileText, X } from 'lucide-react'
import { listRecents, removeRecent } from '../lib/recents'
import type { StoredRecent } from '../lib/docstore'
import { getTabContent } from '../lib/tabContent'
import { getHandle } from '../lib/handleStore'
import { useStore } from '../store/useStore'
import { reopenDirectory } from '../lib/fs-access'

interface Props {
  onOpened: () => void
  limit?: number
}

export function RecentsList({ onOpened, limit }: Props) {
  const [items, setItems] = useState<StoredRecent[]>([])
  const openSmart = useStore((s) => s.openSmart)

  const reload = useCallback(async () => {
    const all = await listRecents()
    setItems(limit ? all.slice(0, limit) : all)
  }, [limit])

  useEffect(() => { void reload() }, [reload])

  const handleOpen = useCallback(async (r: StoredRecent) => {
    if (r.kind === 'file' && r.contentKey) {
      const row = await getTabContent(r.contentKey)
      if (row) {
        openSmart({ kind: 'file', fileName: row.name, content: row.body })
        onOpened()
        await reload()
      }
      return
    }
    if (r.kind === 'folder' && r.handleKey) {
      const handle = await getHandle(r.handleKey)
      if (handle) {
        // reopenDirectory returns DirectoryFile[] (not { name, files, handle })
        // We derive the name from the stored recent entry and pass the handle we retrieved.
        const rawFiles = await reopenDirectory(handle).catch(() => null)
        if (rawFiles) {
          openSmart({
            kind: 'folder',
            folderName: r.name,
            handle,
            files: rawFiles.map((f) => ({
              path: f.path,
              name: f.path.split('/').pop() ?? f.path,
              content: f.content,
              lastModified: f.lastModified,
            })),
          })
          onOpened()
          await reload()
          return
        }
      }
      // No handle or permission denied — silently fail (Phase 5 may add a CTA)
    }
  }, [openSmart, onOpened, reload])

  const handleRemove = useCallback(async (r: StoredRecent) => {
    if (r.id !== undefined) {
      await removeRecent(r.id)
      await reload()
    }
  }, [reload])

  if (items.length === 0) return null

  return (
    <ul className="flex flex-col" role="list" aria-label="Recents">
      {items.map((r) => {
        const Icon = r.kind === 'folder' ? Folder : FileText
        return (
          <li
            key={r.id}
            className="group flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100 cursor-pointer"
            onClick={() => void handleOpen(r)}
          >
            <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            <span className="truncate flex-1 text-sm" title={r.name}>{r.name}</span>
            <button
              type="button"
              aria-label={`Remove ${r.name} from recents`}
              onClick={(e) => { e.stopPropagation(); void handleRemove(r) }}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
