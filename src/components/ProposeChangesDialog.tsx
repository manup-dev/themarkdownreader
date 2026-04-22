import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
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
          <div className="bg-white dark:bg-gray-900 rounded-lg p-8 flex flex-col items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Computing diff…
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
