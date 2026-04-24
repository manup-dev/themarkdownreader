import { useState } from 'react'
import { FolderOpen, Database } from 'lucide-react'
import {
  getAnnotationStorageMode,
  setAnnotationStorageMode,
  type AnnotationStorageMode,
} from '../lib/annotation-storage-mode'

export function StorageSettings() {
  const [mode, setMode] = useState<AnnotationStorageMode>(() => getAnnotationStorageMode())

  function pick(m: AnnotationStorageMode) {
    if (m === mode) return
    setMode(m)
    setAnnotationStorageMode(m)
    // Flush any cached per-doc sinks + migration stamps so lazy
    // migration re-runs on the next open in the new target mode.
    void import('../App').then((mod) => {
      try { mod.resetAnnotationSinkRouter() } catch { /* app module not ready */ }
    })
    if (typeof document !== 'undefined') {
      const toast = document.createElement('div')
      toast.className = 'toast-notify'
      toast.textContent = 'Storage mode changed. Open a document to migrate.'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 5_000)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-gray-400" />
        <span className="font-semibold text-gray-800 dark:text-gray-200">Annotation storage</span>
      </header>

      <label className="flex items-start gap-3 rounded border border-gray-200 p-3 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <input
          type="radio"
          name="annotation-storage-mode"
          checked={mode === 'file'}
          onChange={() => pick('file')}
          className="mt-1"
        />
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-3.5 w-3.5" />
            Sidecar file next to markdown
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Saves highlights & comments in <code>.filename.md.annot</code> next to your markdown. Git-friendly, portable.
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Only applies to files opened from a folder. Other docs use the browser store.
          </span>
        </div>
      </label>

      <label className="flex items-start gap-3 rounded border border-gray-200 p-3 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <input
          type="radio"
          name="annotation-storage-mode"
          checked={mode === 'db'}
          onChange={() => pick('db')}
          className="mt-1"
        />
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            <Database className="h-3.5 w-3.5" />
            Local database (this browser)
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Saves annotations in this browser only. Private to this device.
          </span>
        </div>
      </label>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Switching modes migrates each document's annotations on the next open. No data is lost.
      </p>
    </section>
  )
}
