/**
 * Diff two materialized annotation states. Produces an additive +
 * subtractive change set that the AnnotationDiffView renders, and that
 * the PR body generator turns into a human-readable summary.
 *
 * Diff is by id: same id in both → maybe edited; only-base → removed;
 * only-head → added. We reuse the materialize() reducer so callers can
 * pass either raw events or a state.
 */

import type {
  AnnotationEvent,
  DocState,
  MaterializedHighlight,
  MaterializedComment,
} from './annotation-events'
import { materialize } from './annotation-events'

export interface HighlightChange {
  id: string
  before: MaterializedHighlight | null
  after: MaterializedHighlight | null
  kind: 'added' | 'removed' | 'edited' | 'unchanged'
}

export interface CommentChange {
  id: string
  before: MaterializedComment | null
  after: MaterializedComment | null
  kind: 'added' | 'removed' | 'edited' | 'unchanged' | 'resolved' | 'unresolved'
}

export interface AnnotationDiff {
  highlights: {
    added: HighlightChange[]
    removed: HighlightChange[]
    edited: HighlightChange[]
  }
  comments: {
    added: CommentChange[]
    removed: CommentChange[]
    edited: CommentChange[]
    resolved: CommentChange[]
    unresolved: CommentChange[]
  }
  totals: {
    additions: number
    removals: number
    edits: number
  }
}

export function diffStates(base: DocState, head: DocState): AnnotationDiff {
  const hAdded: HighlightChange[] = []
  const hRemoved: HighlightChange[] = []
  const hEdited: HighlightChange[] = []

  const allHighlightIds = new Set<string>([...base.highlights.keys(), ...head.highlights.keys()])
  for (const id of allHighlightIds) {
    const before = base.highlights.get(id) ?? null
    const after = head.highlights.get(id) ?? null
    if (before && !after) hRemoved.push({ id, before, after: null, kind: 'removed' })
    else if (!before && after) hAdded.push({ id, before: null, after, kind: 'added' })
    else if (before && after && (before.color !== after.color || (before.note ?? '') !== (after.note ?? ''))) {
      hEdited.push({ id, before, after, kind: 'edited' })
    }
  }

  const cAdded: CommentChange[] = []
  const cRemoved: CommentChange[] = []
  const cEdited: CommentChange[] = []
  const cResolved: CommentChange[] = []
  const cUnresolved: CommentChange[] = []

  const allCommentIds = new Set<string>([...base.comments.keys(), ...head.comments.keys()])
  for (const id of allCommentIds) {
    const before = base.comments.get(id) ?? null
    const after = head.comments.get(id) ?? null
    if (before && !after) cRemoved.push({ id, before, after: null, kind: 'removed' })
    else if (!before && after) cAdded.push({ id, before: null, after, kind: 'added' })
    else if (before && after) {
      const bodyChanged = before.body !== after.body
      const resolveChanged = before.resolved !== after.resolved
      if (bodyChanged) cEdited.push({ id, before, after, kind: 'edited' })
      if (resolveChanged) {
        if (after.resolved) cResolved.push({ id, before, after, kind: 'resolved' })
        else cUnresolved.push({ id, before, after, kind: 'unresolved' })
      }
    }
  }

  const totals = {
    additions: hAdded.length + cAdded.length,
    removals: hRemoved.length + cRemoved.length,
    edits: hEdited.length + cEdited.length + cResolved.length + cUnresolved.length,
  }

  return {
    highlights: { added: hAdded, removed: hRemoved, edited: hEdited },
    comments: { added: cAdded, removed: cRemoved, edited: cEdited, resolved: cResolved, unresolved: cUnresolved },
    totals,
  }
}

export function diffEvents(base: AnnotationEvent[], head: AnnotationEvent[]): AnnotationDiff {
  return diffStates(materialize(base), materialize(head))
}

export function isEmpty(diff: AnnotationDiff): boolean {
  const { totals } = diff
  return totals.additions === 0 && totals.removals === 0 && totals.edits === 0
}

// ─── PR body generator ──────────────────────────────────────────────────────

/**
 * Build a copy-pasteable PR description for the change set. Title is one
 * line; body is markdown with sections per change type. Uses the doc
 * filename in the title so reviewers don't have to read the diff to know
 * which doc the PR touches.
 */
export interface PrTextOptions {
  diff: AnnotationDiff
  fileName: string
  /** Optional: source URL for a "source: …" footer line. */
  sourceUrl?: string
}

export function buildPrTitle({ diff, fileName }: PrTextOptions): string {
  const parts: string[] = []
  if (diff.totals.additions) parts.push(`+${diff.totals.additions}`)
  if (diff.totals.removals) parts.push(`-${diff.totals.removals}`)
  if (diff.totals.edits) parts.push(`~${diff.totals.edits}`)
  const summary = parts.length ? parts.join(' ') : 'no changes'
  return `Annotations on ${fileName} (${summary})`
}

export function buildPrBody({ diff, fileName, sourceUrl }: PrTextOptions): string {
  const lines: string[] = []
  lines.push(`# Annotation changes — \`${fileName}\``)
  lines.push('')
  lines.push(`> ${diff.totals.additions} added · ${diff.totals.removals} removed · ${diff.totals.edits} edited`)
  lines.push('')

  if (diff.highlights.added.length) {
    lines.push('## Highlights added')
    for (const c of diff.highlights.added) {
      const text = (c.after?.anchor.exact ?? c.after?.anchor.text ?? '').trim().slice(0, 120)
      lines.push(`- ${c.after?.color ? `\`${c.after.color}\` ` : ''}"${text}"`)
    }
    lines.push('')
  }
  if (diff.highlights.edited.length) {
    lines.push('## Highlights edited')
    for (const c of diff.highlights.edited) {
      const text = (c.after?.anchor.exact ?? c.after?.anchor.text ?? '').trim().slice(0, 80)
      const noteChanged = (c.before?.note ?? '') !== (c.after?.note ?? '')
      const colorChanged = c.before?.color !== c.after?.color
      const what = [colorChanged ? 'color' : null, noteChanged ? 'note' : null].filter(Boolean).join(' + ')
      lines.push(`- "${text}" (${what})`)
    }
    lines.push('')
  }
  if (diff.highlights.removed.length) {
    lines.push('## Highlights removed')
    for (const c of diff.highlights.removed) {
      const text = (c.before?.anchor.exact ?? c.before?.anchor.text ?? '').trim().slice(0, 120)
      lines.push(`- "${text}"`)
    }
    lines.push('')
  }

  if (diff.comments.added.length) {
    lines.push('## Comments added')
    for (const c of diff.comments.added) {
      const sel = (c.after?.selectedText ?? '').trim().slice(0, 60)
      const body = (c.after?.body ?? '').replace(/\n+/g, ' ').slice(0, 200)
      lines.push(`- on _"${sel}"_: ${body}`)
    }
    lines.push('')
  }
  if (diff.comments.edited.length) {
    lines.push('## Comments edited')
    for (const c of diff.comments.edited) {
      const sel = (c.after?.selectedText ?? '').trim().slice(0, 60)
      lines.push(`- on _"${sel}"_: body updated`)
    }
    lines.push('')
  }
  if (diff.comments.resolved.length) {
    lines.push('## Comments resolved')
    for (const c of diff.comments.resolved) {
      lines.push(`- on _"${(c.before?.selectedText ?? '').trim().slice(0, 60)}"_`)
    }
    lines.push('')
  }
  if (diff.comments.unresolved.length) {
    lines.push('## Comments reopened')
    for (const c of diff.comments.unresolved) {
      lines.push(`- on _"${(c.before?.selectedText ?? '').trim().slice(0, 60)}"_`)
    }
    lines.push('')
  }
  if (diff.comments.removed.length) {
    lines.push('## Comments removed')
    for (const c of diff.comments.removed) {
      lines.push(`- on _"${(c.before?.selectedText ?? '').trim().slice(0, 60)}"_`)
    }
    lines.push('')
  }

  if (sourceUrl) {
    lines.push('---')
    lines.push(`source: ${sourceUrl}`)
  }
  lines.push('')
  lines.push(`_Generated by md-reader. Sidecar file: \`.${fileName}.annot\`_`)
  return lines.join('\n')
}
