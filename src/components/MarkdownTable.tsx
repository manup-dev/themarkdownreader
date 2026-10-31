import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react'

// Reader table renderer. Tables live inside a narrow reading column, so
// wide ones get: a horizontal scroll container (instead of being crushed),
// an "Expand" toggle that breaks the table out to the full reading pane,
// and drag/keyboard column resizing via handles on the header cells.

const MIN_COL_PX = 48
const KEY_STEP_PX = 16
/** Horizontal breathing room kept on each side of an expanded table. */
const EXPAND_GUTTER_PX = 24

type Props = React.TableHTMLAttributes<HTMLTableElement> & { node?: unknown }

export function MarkdownTable({ children, node: _node, ...props }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [colWidths, setColWidths] = useState<number[] | null>(null)
  const [breakout, setBreakout] = useState<{ marginLeft: number; width: number } | null>(null)

  // Expanded: span the reader's scroll pane (minus a gutter), wherever the
  // table sits — top level, in a blockquote, in a list. Measured from the
  // wrapper's in-flow parent so the result doesn't feed back into itself.
  useEffect(() => {
    if (!expanded) return
    const wrap = wrapRef.current
    const parent = wrap?.parentElement
    const pane = wrap?.closest<HTMLElement>('[data-reader-scroll]')
    if (!wrap || !parent || !pane) return
    const measure = () => {
      const paneRect = pane.getBoundingClientRect()
      const parentRect = parent.getBoundingClientRect()
      // The wrapper's margin is relative to the parent's content box.
      const cs = getComputedStyle(parent)
      const contentLeft = parentRect.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
      const contentWidth = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const width = Math.max(contentWidth, pane.clientWidth - 2 * EXPAND_GUTTER_PX)
      setBreakout({ marginLeft: paneRect.left + EXPAND_GUTTER_PX - contentLeft, width })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(pane)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [expanded])

  const headerWidths = useCallback((): number[] => {
    const row = tableRef.current?.tHead?.rows[0]
    return row ? Array.from(row.cells, (c) => c.getBoundingClientRect().width) : []
  }, [])

  const resizeColumn = useCallback((index: number, base: number[], delta: number) => {
    const next = [...base]
    next[index] = Math.max(MIN_COL_PX, base[index] + delta)
    setColWidths(next)
  }, [])

  const handleIndex = (target: EventTarget | null): number => {
    const handle = (target as HTMLElement | null)?.closest?.('[data-col-resize]')
    const th = handle?.closest('th')
    if (!th || !th.parentElement) return -1
    return Array.prototype.indexOf.call(th.parentElement.children, th)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const index = handleIndex(e.target)
    if (index < 0) return
    e.preventDefault()
    const handle = e.target as HTMLElement
    const base = colWidths ?? headerWidths()
    const startX = e.clientX
    handle.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => resizeColumn(index, base, ev.clientX - startX)
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const index = handleIndex(e.target)
    if (index < 0) return
    e.preventDefault()
    resizeColumn(index, colWidths ?? headerWidths(), e.key === 'ArrowRight' ? KEY_STEP_PX : -KEY_STEP_PX)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (handleIndex(e.target) >= 0) setColWidths(null)
  }

  const sized = colWidths !== null
  return (
    <div
      ref={wrapRef}
      data-md-table=""
      className={`md-table${expanded ? ' md-table--expanded' : ''}${sized ? ' md-table--sized' : ''}`}
      style={expanded && breakout ? { marginLeft: breakout.marginLeft, width: breakout.width } : undefined}
    >
      <div className="md-table__tools" role="toolbar" aria-label="Table view">
        {sized && (
          <button type="button" onClick={() => setColWidths(null)} title="Reset column widths" aria-label="Reset column widths">
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Fit table to the text column' : 'Expand table to the full width'}
          aria-label={expanded ? 'Collapse table' : 'Expand table'}
          aria-pressed={expanded}
        >
          {expanded ? <Minimize2 aria-hidden className="h-3.5 w-3.5" /> : <Maximize2 aria-hidden className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="md-table__scroll" onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={onDoubleClick}>
        <table
          ref={tableRef}
          {...props}
          style={sized ? { ...props.style, tableLayout: 'fixed', width: colWidths.reduce((a, b) => a + b, 0) } : props.style}
        >
          {sized && (
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
          )}
          {children}
        </table>
      </div>
    </div>
  )
}

type ThProps = React.ThHTMLAttributes<HTMLTableCellElement> & { node?: unknown }

/** Header cell with a column-resize handle on its right edge. */
export function MarkdownTh({ children, node: _node, ...props }: ThProps) {
  return (
    <th {...props}>
      {children}
      <span
        data-col-resize=""
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column (drag, or ← → keys; double-click to reset)"
        tabIndex={0}
      />
    </th>
  )
}
