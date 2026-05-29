import path from 'node:path'

/**
 * Decide whether a PostToolUse event should open a doc in md-reader.
 * Pure: no I/O, no clock — caller passes `now`, `state`, and `opts`.
 *
 * @param {{toolName:string, filePath:string, cwd:string}} event
 * @param {{opened: Record<string, number>}} state  last-opened ts (ms) per relPath
 * @param {{baseUrl:string, now:number, windowMs:number}} opts
 * @returns {{open:boolean, reason:string, relPath?:string, url?:string}}
 */
export function decideOpen(event, state, opts) {
  const { toolName, filePath, cwd } = event
  if (toolName !== 'Write') return { open: false, reason: 'not-a-write' }
  if (!filePath || !filePath.endsWith('.md')) return { open: false, reason: 'not-markdown' }

  const relPath = path.relative(cwd, filePath)
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) {
    return { open: false, reason: 'outside-project' }
  }

  const last = state?.opened?.[relPath]
  if (typeof last === 'number' && opts.now - last < opts.windowMs) {
    return { open: false, reason: 'deduped' }
  }

  const params = new URLSearchParams({ file: relPath, view: 'read' })
  const url = `${opts.baseUrl}/#${params.toString()}`
  return { open: true, reason: 'open', relPath, url }
}
