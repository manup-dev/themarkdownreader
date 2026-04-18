/**
 * Pins the simplified SelectionMenu contract:
 * - Primary row shows exactly four labeled actions: Highlight, Comment, Copy, Chat
 * - Secondary actions (Explain, ELI5, Define, Find, Glossary) are hidden
 *   behind a "More" (⋯) button so the default surface stays uncluttered
 * - Clicking Highlight reveals a color picker; picking a color calls
 *   addHighlight and dispatches md-reader-highlight-changed so Reader can
 *   re-paint persistent inline highlight spans
 * - Clicking Comment reveals an inline composer
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SelectionMenu } from '../components/SelectionMenu'
import { useStore } from '../store/useStore'
import { MdReaderProvider } from '../provider/MdReaderProvider'
import type { StorageAdapter } from '../types/storage-adapter'

// jsdom does not implement Range.getBoundingClientRect — stub it so the
// SelectionMenu's mouseup handler (which positions the popover) can run.
if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
}
if (typeof Range !== 'undefined' && !(Range.prototype as unknown as { getClientRects?: unknown }).getClientRects) {
  ;(Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => []
}

// Mock the docstore so the test doesn't need IndexedDB
const addHighlightMock = vi.fn<(arg: unknown) => Promise<number>>(async () => 1)
const getHighlightsMock = vi.fn<(arg: unknown) => Promise<unknown[]>>(async () => [])
const addCommentMock = vi.fn<(arg: unknown) => Promise<number>>(async () => 1)
const addDocumentMock = vi.fn<(a: unknown, b: unknown) => Promise<{ docId: number; isNew: boolean }>>(async () => ({ docId: 42, isNew: true }))

vi.mock('../lib/docstore', async () => {
  const actual = await vi.importActual<typeof import('../lib/docstore')>('../lib/docstore')
  return {
    ...actual,
    addHighlight: (arg: unknown) => addHighlightMock(arg),
    getHighlights: (arg: unknown) => getHighlightsMock(arg),
    removeHighlight: vi.fn(),
    updateHighlightNote: vi.fn(),
    addComment: (arg: unknown) => addCommentMock(arg),
    addDocument: (a: unknown, b: unknown) => addDocumentMock(a, b),
  }
})

const mockAdapter = {
  addHighlight: (arg: unknown) => addHighlightMock(arg),
  getHighlights: (arg: unknown) => getHighlightsMock(arg),
  removeHighlight: vi.fn(),
  updateHighlightNote: vi.fn(),
  addComment: (arg: unknown) => addCommentMock(arg),
  addDocument: (a: unknown, b: unknown) => addDocumentMock(a, b),
} as unknown as StorageAdapter

function renderWithProvider(ui: React.ReactElement) {
  return render(<MdReaderProvider adapter={mockAdapter}>{ui}</MdReaderProvider>)
}

// Helper: fake a non-collapsed text selection inside the document
function fakeSelection(text: string) {
  const host = document.createElement('p')
  host.textContent = text
  document.body.appendChild(host)
  const range = document.createRange()
  range.selectNodeContents(host)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  return host
}

describe('<SelectionMenu> — simplified primary actions', () => {
  beforeEach(() => {
    addHighlightMock.mockClear()
    getHighlightsMock.mockClear()
    addCommentMock.mockClear()
    addDocumentMock.mockClear()
    localStorage.removeItem('md-reader-last-highlight-color')
    useStore.setState({
      markdown: '# Doc\n\nHello world',
      fileName: 'doc.md',
      activeDocId: 99,
    })
  })

  afterEach(() => {
    cleanup()
    document.body.querySelectorAll('p').forEach((p) => p.remove())
    window.getSelection()?.removeAllRanges()
  })

  it('shows exactly four primary actions (Highlight, Comment, Copy, Chat)', async () => {
    renderWithProvider(<SelectionMenu />)
    const host = fakeSelection('some selected text')

    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^highlight$/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /^comment$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument()

    // Secondary actions should NOT be on the primary surface
    expect(screen.queryByRole('button', { name: /explain with ai/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /simplify/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /define/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /find in document/i })).not.toBeInTheDocument()
  })

  it('clicking Highlight one-click-applies the last-used color and dispatches md-reader-highlight-changed', async () => {
    // Seed last-used color = green so we can prove it's honored
    localStorage.setItem('md-reader-last-highlight-color', '#bbf7d0')

    renderWithProvider(<SelectionMenu />)
    const host = fakeSelection('phrase to highlight')
    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => screen.getByRole('button', { name: /^highlight$/i }))

    const spy = vi.fn()
    window.addEventListener('md-reader-highlight-changed', spy)

    fireEvent.click(screen.getByRole('button', { name: /^highlight$/i }))

    // One-click applies the last color — no need to open picker first
    await waitFor(() => expect(addHighlightMock).toHaveBeenCalledTimes(1))
    const arg = addHighlightMock.mock.calls[0]?.[0] as { color: string; text: string } | undefined
    expect(arg?.color).toBe('#bbf7d0')  // remembered color
    expect(arg?.text).toBe('phrase to highlight')
    await waitFor(() => expect(spy).toHaveBeenCalled())
    window.removeEventListener('md-reader-highlight-changed', spy)
  })

  it('strips trailing punctuation and dangling conjunctions from the captured selection text', async () => {
    renderWithProvider(<SelectionMenu />)
    // Dirty selection: trailing comma, space, and "and"
    const host = fakeSelection('shipping are two distinct problems, and')
    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => screen.getByRole('button', { name: /^highlight$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^highlight$/i }))

    await waitFor(() => expect(addHighlightMock).toHaveBeenCalledTimes(1))
    const arg = addHighlightMock.mock.calls[0]?.[0] as { text: string } | undefined
    expect(arg?.text).toBe('shipping are two distinct problems')
  })

  it('saving a comment attributes it to the nearest preceding heading — not to the stale activeSection', async () => {
    // Seed an article with TWO sections. The selection lives deep inside
    // section 2 ("deep-section") while activeSection still points at the H1.
    const article = document.createElement('article')
    article.innerHTML = `
      <h1 id="top-heading">Top heading</h1>
      <p>Intro paragraph.</p>
      <h2 id="deep-section">Deep section</h2>
      <p id="target-para">Actual target text lives here, far from the top heading.</p>
    `
    document.body.appendChild(article)
    // activeSection stale — points at the H1, as if user scrolled to it
    useStore.setState({ activeSection: 'top-heading' })

    // Select a phrase inside #target-para (which sits under #deep-section)
    const para = document.getElementById('target-para')!
    const tn = para.firstChild as Text
    const range = document.createRange()
    const idx = tn.textContent!.indexOf('target text')
    range.setStart(tn, idx)
    range.setEnd(tn, idx + 'target text'.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    renderWithProvider(<SelectionMenu />)
    fireEvent.mouseUp(document, { target: para })
    await waitFor(() => screen.getByRole('button', { name: /^comment$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }))
    const textarea = await screen.findByPlaceholderText(/add a comment/i)
    fireEvent.change(textarea, { target: { value: 'note' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(addCommentMock).toHaveBeenCalled())
    const saved = addCommentMock.mock.calls[0]?.[0] as { sectionId: string; selectedText: string } | undefined
    expect(saved?.sectionId).toBe('deep-section')  // ← nearest preceding heading
    expect(saved?.selectedText).toBe('target text')

    article.remove()
  })

  it('right-clicking Highlight opens the color swatch row (for explicit color choice)', async () => {
    renderWithProvider(<SelectionMenu />)
    const host = fakeSelection('phrase to highlight')
    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => screen.getByRole('button', { name: /^highlight$/i }))

    // Picker hidden by default
    expect(screen.queryByLabelText(/highlight yellow/i)).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: /^highlight$/i }))

    const yellow = await screen.findByLabelText(/highlight yellow/i)
    expect(yellow).toBeInTheDocument()
    expect(screen.getByLabelText(/highlight green/i)).toBeInTheDocument()
  })

  it('clicking Comment reveals an inline composer', async () => {
    renderWithProvider(<SelectionMenu />)
    const host = fakeSelection('passage needing a note')
    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => screen.getByRole('button', { name: /^comment$/i }))

    // Composer is hidden by default
    expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }))

    expect(await screen.findByPlaceholderText(/add a comment/i)).toBeInTheDocument()
  })

  it('secondary actions appear under the More (⋯) menu, not the primary row', async () => {
    renderWithProvider(<SelectionMenu />)
    const host = fakeSelection('selected')
    fireEvent.mouseUp(document, { target: host })

    await waitFor(() => screen.getByRole('button', { name: /^highlight$/i }))

    const moreBtn = screen.getByRole('button', { name: /more actions/i })
    fireEvent.click(moreBtn)

    expect(await screen.findByRole('button', { name: /explain with ai/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /simplify/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /define/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /find in document/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save to glossary/i })).toBeInTheDocument()
  })
})

/**
 * Stress test the DOM reconciliation strategy used by the Reader's inline
 * highlight effect. We replicate the unwrap-and-reapply algorithm in
 * isolation so regressions in deletion / overlap / double-apply are caught
 * without needing to mount the full Reader.
 */
describe('Reader-style highlight reconciliation — stress', () => {
  function applyHighlights(article: HTMLElement, highlights: Array<{ id: number; text: string; color: string }>) {
    // Unwrap existing
    article.querySelectorAll('[data-highlight-id]').forEach((el) => {
      const parent = el.parentNode!
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
      parent.normalize()
    })
    // Apply
    for (const h of highlights) {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      let node: Text | null
      while ((node = walker.nextNode() as Text | null)) {
        if (node.parentElement?.closest('[data-highlight-id]')) continue
        const idx = node.textContent?.indexOf(h.text) ?? -1
        if (idx === -1) continue
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + h.text.length)
        const span = document.createElement('span')
        span.setAttribute('data-highlight-id', String(h.id))
        span.setAttribute('data-highlight-color', h.color)
        span.style.backgroundColor = h.color
        try { range.surroundContents(span); break } catch { /* skip */ }
      }
    }
  }

  let article: HTMLElement
  beforeEach(() => {
    article = document.createElement('article')
    article.innerHTML = '<p>Alpha beta gamma delta epsilon zeta eta theta</p>'
    document.body.appendChild(article)
  })
  afterEach(() => { article.remove() })

  it('adds a persistent highlight span', () => {
    applyHighlights(article, [{ id: 1, text: 'beta', color: '#fef08a' }])
    const spans = article.querySelectorAll('[data-highlight-id="1"]')
    expect(spans.length).toBe(1)
    expect(spans[0].textContent).toBe('beta')
    expect((spans[0] as HTMLElement).style.backgroundColor).toBeTruthy()
  })

  it('removes a highlight cleanly when it is no longer in the list', () => {
    applyHighlights(article, [{ id: 1, text: 'beta', color: '#fef08a' }])
    expect(article.querySelectorAll('[data-highlight-id]').length).toBe(1)
    applyHighlights(article, [])
    expect(article.querySelectorAll('[data-highlight-id]').length).toBe(0)
    // Text is still intact after unwrap
    expect(article.textContent).toBe('Alpha beta gamma delta epsilon zeta eta theta')
  })

  it('handles multiple non-overlapping highlights independently', () => {
    applyHighlights(article, [
      { id: 1, text: 'beta', color: '#fef08a' },
      { id: 2, text: 'delta', color: '#bbf7d0' },
    ])
    expect(article.querySelector('[data-highlight-id="1"]')?.textContent).toBe('beta')
    expect(article.querySelector('[data-highlight-id="2"]')?.textContent).toBe('delta')
  })

  it('reflects a color change for the same highlight id', () => {
    applyHighlights(article, [{ id: 1, text: 'beta', color: '#fef08a' }])
    const first = article.querySelector('[data-highlight-id="1"]') as HTMLElement
    const firstColor = first.style.backgroundColor
    applyHighlights(article, [{ id: 1, text: 'beta', color: '#bfdbfe' }])
    const after = article.querySelector('[data-highlight-id="1"]') as HTMLElement
    expect(after).toBeTruthy()
    expect(after.style.backgroundColor).not.toBe(firstColor)
    // Still only one span
    expect(article.querySelectorAll('[data-highlight-id="1"]').length).toBe(1)
  })

  it('does not double-wrap when reapplied multiple times in a row', () => {
    const hs = [{ id: 1, text: 'beta', color: '#fef08a' }]
    applyHighlights(article, hs)
    applyHighlights(article, hs)
    applyHighlights(article, hs)
    expect(article.querySelectorAll('[data-highlight-id]').length).toBe(1)
    expect(article.textContent).toBe('Alpha beta gamma delta epsilon zeta eta theta')
  })

  it('removing the middle of three highlights keeps the other two intact', () => {
    applyHighlights(article, [
      { id: 1, text: 'beta', color: '#fef08a' },
      { id: 2, text: 'delta', color: '#bbf7d0' },
      { id: 3, text: 'eta', color: '#bfdbfe' },
    ])
    applyHighlights(article, [
      { id: 1, text: 'beta', color: '#fef08a' },
      { id: 3, text: 'eta', color: '#bfdbfe' },
    ])
    expect(article.querySelector('[data-highlight-id="1"]')).toBeTruthy()
    expect(article.querySelector('[data-highlight-id="2"]')).toBeNull()
    expect(article.querySelector('[data-highlight-id="3"]')).toBeTruthy()
    expect(article.textContent).toBe('Alpha beta gamma delta epsilon zeta eta theta')
  })
})
