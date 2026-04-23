import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAdapter } from '../provider/hooks'
import { AnnotationDiffView } from './AnnotationDiffView'
import { type AnnotationEvent } from '../lib/annotation-events'
import { legacyEventsForDoc, deriveDocKey } from '../lib/docstore'

interface ProposeChangesDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Modal wrapper that gathers both sides of the diff and hands them to
 * AnnotationDiffView. The "base" is the remote share as it arrived
 * (stashed on the remoteShare slice at import time); the "head" is
 * whatever the user's local highlights + comments look like right now,
 * projected through the legacy-row → events converter.
 */
export function ProposeChangesDialog({ open, onClose }: ProposeChangesDialogProps) {
  const remoteShare = useStore((s) => s.remoteShare)
  const fileName = useStore((s) => s.fileName) ?? 'document.md'
  const adapter = useAdapter()

  const [headEvents, setHeadEvents] = useState<AnnotationEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !remoteShare?.docId) return
    let cancelled = false
    const docId = remoteShare.docId
    ;(async () => {
      try {
        const doc = await adapter.getDocument(docId)
        if (!doc) {
          setError('Document not found in the local library.')
          return
        }
        const events = await legacyEventsForDoc(docId, deriveDocKey(doc))
        if (!cancelled) setHeadEvents(events)
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Failed to read local annotations')
      }
    })()
    return () => { cancelled = true }
  }, [open, remoteShare?.docId, adapter])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const baseEvents: AnnotationEvent[] = remoteShare?.originalEvents ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="propose-dialog-title"
    >
      <div
        className="bg-transparent w-full max-w-3xl mx-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute right-2 top-2 z-10">
          <button
            onClick={onClose}
            className="p-1.5 rounded bg-white/80 dark:bg-gray-900/80 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!error && !headEvents && (
          // Skeleton loader shaped like the final diff — feels faster than
          // a centered spinner because the layout is already committed.
          // Only the empty bar widths are animated (pulse).
          <div className="bg-white dark:bg-gray-900 sepia:bg-sepia-50 rounded-lg shadow-md p-4 max-w-3xl mx-auto animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="h-4 w-64 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
            </div>
            <div className="space-y-3">
              <div>
                <div className="h-3 w-32 bg-gray-200 dark:bg-gray-800 rounded mb-2" />
                <div className="space-y-1.5">
                  <div className="h-8 bg-gray-100 dark:bg-gray-800/60 rounded" />
                  <div className="h-8 bg-gray-100 dark:bg-gray-800/60 rounded" />
                </div>
              </div>
              <div>
                <div className="h-3 w-40 bg-gray-200 dark:bg-gray-800 rounded mb-2" />
                <div className="h-8 bg-gray-100 dark:bg-gray-800/60 rounded" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
              <div className="h-7 bg-gray-100 dark:bg-gray-800/60 rounded" />
              <div className="h-7 bg-gray-100 dark:bg-gray-800/60 rounded" />
            </div>
            <span className="sr-only">Computing diff…</span>
          </div>
        )}

        {!error && headEvents && (
          <AnnotationDiffView
            baseEvents={baseEvents}
            headEvents={headEvents}
            fileName={fileName}
            sourceUrl={remoteShare?.sourceUrl}
          />
        )}
      </div>
    </div>
  )
}
