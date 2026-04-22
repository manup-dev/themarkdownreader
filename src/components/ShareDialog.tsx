import { useEffect, useState, useCallback } from 'react'
import { Copy, Download, Link as LinkIcon, X, Check, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAdapter } from '../provider/hooks'
import { buildShareForDocument, downloadSidecar, type BuiltShare } from '../lib/share-builder'
import type { StoredDocument } from '../types/storage-adapter'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Public URL of the markdown doc, if known. When omitted, the dialog
   * still produces a downloadable sidecar but cannot offer a copy-link
   * flow (no public source → no fetchable URL).
   */
  publicDocUrl?: string
}

/**
 * Share dialog. Lazy-builds the WAL when opened so we don't spend work
 * on every render; rebuilds only when the doc changes. Presents two
 * actions that respect the project's "commit yourself" posture:
 *   - Copy share link (inline/URL-pair picked automatically).
 *   - Download sidecar file (`.foo.md.annot` — user commits it next to
 *     the .md in their own git workflow).
 */
export function ShareDialog({ open, onClose, publicDocUrl }: ShareDialogProps) {
  const activeDocId = useStore((s) => s.activeDocId)
  const fileName = useStore((s) => s.fileName)
  const adapter = useAdapter()
  const [built, setBuilt] = useState<BuiltShare | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const rebuild = useCallback(async () => {
    if (!activeDocId) {
      setError('Save the document to the library first (no local id yet).')
      setBuilt(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const doc: StoredDocument | undefined = await adapter.getDocument(activeDocId)
      if (!doc) {
        setError('Document not found in the library.')
        setBuilt(null)
        return
      }
      const result = await buildShareForDocument({
        doc,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        publicDocUrl,
      })
      setBuilt(result)
    } catch (e) {
      setError((e as Error).message || 'Failed to build share')
    } finally {
      setLoading(false)
    }
  }, [activeDocId, adapter, publicDocUrl])

  useEffect(() => {
    if (open) void rebuild()
  }, [open, rebuild])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const handleCopy = useCallback(async () => {
    if (!built?.url) return
    try {
      await navigator.clipboard.writeText(built.url)
      setCopied(true)
    } catch {
      setError('Clipboard write blocked — select the URL manually.')
    }
  }, [built])

  const handleDownload = useCallback(() => {
    if (!built) return
    downloadSidecar(built.sidecarFileName, built.wal)
  }, [built])

  // Close on ESC
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
    >
      <div
        className="bg-white dark:bg-gray-900 sepia:bg-sepia-50 text-gray-900 dark:text-gray-100 sepia:text-sepia-900 rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 sepia:border-sepia-200">
          <h2 id="share-dialog-title" className="text-base font-semibold flex items-center gap-2">
            <LinkIcon className="h-4 w-4" /> Share this read
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100"
            aria-label="Close share dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm">
          {loading && <p className="text-gray-500">Preparing share…</p>}
          {error && (
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {built && (
            <>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium">{fileName || 'document.md'}</span>
                {' · '}
                {built.highlightCount} highlight{built.highlightCount === 1 ? '' : 's'}
                {', '}{built.commentCount} comment{built.commentCount === 1 ? '' : 's'}
                {' · '}
                {formatBytes(built.bytes)} WAL
              </div>

              {built.inlineOverflowed && (
                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 text-xs">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>Too many annotations to fit inline — using URL-pair mode. Recipient fetches the sidecar from the source host.</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Copy share link
                  {built.urlKind && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{built.urlKind}</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={built.url ?? 'No public URL provided — use Download instead.'}
                    className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-700 sepia:border-sepia-200 rounded bg-gray-50 dark:bg-gray-800 sepia:bg-sepia-100 truncate"
                    aria-label="Share URL"
                  />
                  <button
                    onClick={handleCopy}
                    disabled={!built.url}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 dark:border-gray-800 sepia:border-sepia-200">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 sepia:border-sepia-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100"
                >
                  <Download className="h-3.5 w-3.5" /> Download {built.sidecarFileName}
                </button>
                <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  Commit this file next to <span className="font-mono">{fileName}</span> in your own git workflow.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
