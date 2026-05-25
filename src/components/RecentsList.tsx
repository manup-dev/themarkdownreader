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
  const [errors, setErrors] = useState<Map<number, string>>(new Map())
  const openSmart = useStore((s) => s.openSmart)

  const reload = useCallback(async () => {
    const all = await listRecents()
    setItems(limit ? all.slice(0, limit) : all)
  }, [limit])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate mount-time fetch from IDB
  useEffect(() => { void reload() }, [reload])

  const handleOpen = useCallback(async (r: StoredRecent) => {
    if (r.id !== undefined) {
      setErrors((prev) => {
        const next = new Map(prev)
        next.delete(r.id!)
        return next
      })
    }
    if (r.kind === 'file' && r.contentKey) {
      const row = await getTabContent(r.contentKey)
      if (row) {
        openSmart({ kind: 'file', fileName: row.name, content: row.body })
        onOpened()
        await reload()
      } else if (r.id !== undefined) {
        setErrors((prev) => new Map(prev).set(r.id!, 'Content no longer cached'))
      }
      return
    }
    if (r.kind === 'folder' && r.handleKey && r.id !== undefined) {
      const handle = await getHandle(r.handleKey)
      if (!handle) {
        setErrors((prev) => new Map(prev).set(r.id!, 'Permission lost — re-pick folder via Open menu'))
        return
      }
      try {
        const rawFiles = await reopenDirectory(handle)
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
      } catch {
        setErrors((prev) => new Map(prev).set(r.id!, 'Permission denied — re-pick folder via Open menu'))
      }
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
          <li key={r.id} className="group relative" role="none">
            <button
              type="button"
              onClick={() => void handleOpen(r)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span className="truncate flex-1 text-sm" title={r.name}>{r.name}</span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${r.name} from recents`}
              onClick={(e) => { e.stopPropagation(); void handleRemove(r) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
            {errors.get(r.id ?? -1) && (
              <div className="px-3 pb-2 text-xs text-red-600 dark:text-red-400" role="alert">
                {errors.get(r.id ?? -1)}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
