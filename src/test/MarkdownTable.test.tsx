/**
 * Reader table controls: horizontal-scroll wrapper, per-table "Expand"
 * toggle, and keyboard/drag column resizing with reset. Layout itself (the
 * mid-word wrapping fix) is CSS and is covered by the Playwright drive.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownTable, MarkdownTh } from '../components/MarkdownTable'
import { parseContentWidth } from '../store/useStore'

const md = '| Area | Change |\n|---|---|\n| Coding bank | Image processing pipeline added |\n| New round | Agentic PR review |\n'

function renderTable() {
  return render(
    <Markdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable as never, th: MarkdownTh as never }}>
      {md}
    </Markdown>,
  )
}

afterEach(cleanup)

describe('MarkdownTable', () => {
  it('wraps the table in a scroll container with a view toolbar', () => {
    const { container } = renderTable()
    const wrap = container.querySelector('[data-md-table]')!
    expect(wrap.querySelector('.md-table__scroll > table')).not.toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Table view' })).toBeTruthy()
    // One resize handle per header cell; header text is untouched.
    expect(container.querySelectorAll('th [data-col-resize]')).toHaveLength(2)
    expect(container.querySelector('th')!.textContent).toBe('Area')
  })

  it('toggles expanded mode', () => {
    const { container } = renderTable()
    const btn = screen.getByRole('button', { name: 'Expand table' })
    fireEvent.click(btn)
    expect(container.querySelector('.md-table--expanded')).not.toBeNull()
    const collapse = screen.getByRole('button', { name: 'Collapse table' })
    expect(collapse.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(collapse)
    expect(container.querySelector('.md-table--expanded')).toBeNull()
  })

  it('resizes a column from the keyboard and resets it', () => {
    const { container } = renderTable()
    const table = container.querySelector('table')!
    expect(container.querySelector('colgroup')).toBeNull()

    const handle = container.querySelectorAll<HTMLElement>('[data-col-resize]')[0]
    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    const cols = container.querySelectorAll('colgroup col')
    expect(cols).toHaveLength(2)
    expect(table.style.tableLayout).toBe('fixed')
    // Never narrower than the minimum column width.
    expect(parseFloat((cols[0] as HTMLElement).style.width)).toBeGreaterThanOrEqual(48)

    fireEvent.click(screen.getByRole('button', { name: 'Reset column widths' }))
    expect(container.querySelector('colgroup')).toBeNull()
    expect(table.style.tableLayout).toBe('')
  })

  it('double-clicking a handle resets widths', () => {
    const { container } = renderTable()
    const handle = container.querySelectorAll<HTMLElement>('[data-col-resize]')[1]
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(container.querySelector('colgroup')).not.toBeNull()
    fireEvent.doubleClick(handle)
    expect(container.querySelector('colgroup')).toBeNull()
  })
})

describe('parseContentWidth', () => {
  it('accepts known widths and falls back to normal', () => {
    expect(parseContentWidth('wide')).toBe('wide')
    expect(parseContentWidth('full')).toBe('full')
    expect(parseContentWidth(null)).toBe('normal')
    expect(parseContentWidth('huge')).toBe('normal')
  })
})
