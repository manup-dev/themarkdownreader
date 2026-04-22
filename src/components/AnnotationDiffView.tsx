import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, Minus, Edit3, CheckCircle2, Circle, Copy, Check, Download, AlertCircle } from 'lucide-react'
import {
  diffEvents,
  isEmpty,
  buildPrTitle,
  buildPrBody,
  type AnnotationDiff,
} from '../lib/annotation-diff'
import {
  encodeWal,
  type AnnotationEvent,
} from '../lib/annotation-events'
import { downloadSidecar, sidecarBasename } from '../lib/share-builder'

interface AnnotationDiffViewProps {
  /** Base events (e.g. the upstream WAL the recipient pulled). */
  baseEvents: AnnotationEvent[]
  /** Head events (the local state after the user's edits). */
  headEvents: AnnotationEvent[]
  /** Document file name — used in PR title + sidecar download name. */
  fileName: string
  /** Optional source URL for the PR body footer. */
  sourceUrl?: string
}

/**
 * Renders a side-by-side diff of two annotation states. The "head" column
 * is the user's local state; the "base" column is whatever upstream has.
 * Buckets changes by kind (added / removed / edited / resolved) and lets
 * the user copy a PR title + body or download the head sidecar.
 *
 * Useful for: previewing a Fork before publishing, reviewing an incoming
 * share against your local notes, generating a GitHub PR body.
 */
export function AnnotationDiffView({ baseEvents, headEvents, fileName, sourceUrl }: AnnotationDiffViewProps) {
  const diff = useMemo<AnnotationDiff>(() => diffEvents(baseEvents, headEvents), [baseEvents, headEvents])
  const empty = isEmpty(diff)
  const prTitle = useMemo(() => buildPrTitle({ diff, fileName }), [diff, fileName])
  const prBody = useMemo(() => buildPrBody({ diff, fileName, sourceUrl }), [diff, fileName, sourceUrl])
  const [copied, setCopied] = useState<'title' | 'body' | null>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const copy = useCallback(async (which: 'title' | 'body', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }, [])

  const downloadHead = useCallback(() => {
    downloadSidecar(sidecarBasename(fileName), encodeWal(headEvents))
  }, [fileName, headEvents])

  return (
    <div className="bg-white dark:bg-gray-900 sepia:bg-sepia-50 text-gray-900 dark:text-gray-100 sepia:text-sepia-900 rounded-lg shadow-md p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Annotation diff — <span className="font-mono">{fileName}</span></h2>
        <span className="text-xs text-gray-500">
          +{diff.totals.additions} −{diff.totals.removals} ~{diff.totals.edits}
        </span>
      </div>

      {empty && (
        <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 dark:bg-gray-800 p-3 rounded">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>No changes between the two states.</span>
        </div>
      )}

      {!empty && (
        <div className="space-y-3 text-sm">
          <DiffSection
            label="Added highlights"
            icon={<Plus className="h-3.5 w-3.5 text-green-600" />}
            items={diff.highlights.added.map((c) => ({
              key: c.id,
              text: (c.after?.anchor.exact ?? c.after?.anchor.text ?? ''),
              meta: c.after?.color,
            }))}
          />
          <DiffSection
            label="Removed highlights"
            icon={<Minus className="h-3.5 w-3.5 text-red-600" />}
            items={diff.highlights.removed.map((c) => ({
              key: c.id,
              text: (c.before?.anchor.exact ?? c.before?.anchor.text ?? ''),
            }))}
          />
          <DiffSection
            label="Edited highlights"
            icon={<Edit3 className="h-3.5 w-3.5 text-amber-600" />}
            items={diff.highlights.edited.map((c) => ({
              key: c.id,
              text: (c.after?.anchor.exact ?? c.after?.anchor.text ?? ''),
              meta: `${c.before?.color ?? ''} → ${c.after?.color ?? ''}`,
            }))}
          />

          <DiffSection
            label="Added comments"
            icon={<Plus className="h-3.5 w-3.5 text-green-600" />}
            items={diff.comments.added.map((c) => ({
              key: c.id,
              text: (c.after?.body ?? '').slice(0, 200),
              meta: c.after?.author,
              quote: c.after?.selectedText,
            }))}
          />
          <DiffSection
            label="Edited comments"
            icon={<Edit3 className="h-3.5 w-3.5 text-amber-600" />}
            items={diff.comments.edited.map((c) => ({
              key: c.id,
              text: c.after?.body ?? '',
              quote: c.after?.selectedText,
            }))}
          />
          <DiffSection
            label="Resolved"
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
            items={diff.comments.resolved.map((c) => ({
              key: c.id,
              text: c.before?.body ?? '',
              quote: c.before?.selectedText,
            }))}
          />
          <DiffSection
            label="Reopened"
            icon={<Circle className="h-3.5 w-3.5 text-gray-600" />}
            items={diff.comments.unresolved.map((c) => ({
              key: c.id,
              text: c.before?.body ?? '',
              quote: c.before?.selectedText,
            }))}
          />
          <DiffSection
            label="Removed comments"
            icon={<Minus className="h-3.5 w-3.5 text-red-600" />}
            items={diff.comments.removed.map((c) => ({
              key: c.id,
              text: c.before?.body ?? '',
              quote: c.before?.selectedText,
            }))}
          />
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 sepia:border-sepia-200 space-y-2">
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={prTitle}
            className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800 truncate"
            aria-label="PR title"
          />
          <button
            onClick={() => copy('title', prTitle)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {copied === 'title' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Title
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => copy('body', prBody)}
            className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-500"
          >
            {copied === 'body' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy PR body to clipboard
          </button>
          <button
            onClick={downloadHead}
            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
            title={`Download ${sidecarBasename(fileName)}`}
          >
            <Download className="h-3.5 w-3.5" /> Sidecar
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Paste the title + body into a GitHub PR. Drop the sidecar file alongside <span className="font-mono">{fileName}</span> in your repo, then commit + push.
        </p>
      </div>
    </div>
  )
}

interface DiffItem { key: string; text: string; meta?: string; quote?: string }
interface DiffSectionProps { label: string; icon: React.ReactNode; items: DiffItem[] }

function DiffSection({ label, icon, items }: DiffSectionProps) {
  if (!items.length) return null
  return (
    <section>
      <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        {icon} {label} <span className="font-normal text-gray-400">({items.length})</span>
      </h3>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.key} className="text-xs px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 sepia:bg-sepia-100">
            {it.quote && (
              <div className="text-gray-500 italic truncate">on: "{it.quote.slice(0, 80)}"</div>
            )}
            <div className="truncate">{it.text}</div>
            {it.meta && <div className="text-gray-400 text-[10px] mt-0.5">{it.meta}</div>}
          </li>
        ))}
      </ul>
    </section>
  )
}
