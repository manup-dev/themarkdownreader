/**
 * Pins the Comments-panel "Jump to" behavior so clicking a comment lands
 * on the actual highlighted passage instead of the section heading.
 *
 * Context: Originally handleJumpTo scrolled to `document.getElementById(sectionId)`,
 * which jumped to the section heading — a notable miss when the quoted text
 * sat several paragraphs below the heading. The fix prefers the inline
 * [data-comment-highlight="<id>"] span that the Reader applies, and only
 * falls back to the section heading if the span can't be found.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { CommentsPanel } from '../components/CommentsPanel'
import { useStore } from '../store/useStore'
import type { Comment } from '../lib/docstore'

const sampleComment: Comment = {
  id: 7,
  docId: 1,
  selectedText: 'shipping are two distinct problems',
  comment: 'This line is the core thesis',
  author: 'Tester',
  sectionId: 'why-md-reader-exists',
  createdAt: Date.now(),
  resolved: false,
}

const getCommentsMock = vi.fn<(docId: number) => Promise<Comment[]>>(async () => [sampleComment])

vi.mock('../lib/docstore', async () => {
  const actual = await vi.importActual<typeof import('../lib/docstore')>('../lib/docstore')
  return {
    ...actual,
    getComments: (docId: number) => getCommentsMock(docId),
    updateComment: vi.fn(),
    removeComment: vi.fn(),
  }
})

function buildArticle() {
  document.body.innerHTML = ''
  const article = document.createElement('article')

  const heading = document.createElement('h2')
  heading.id = 'why-md-reader-exists'
  heading.textContent = 'Why md-reader exists'
  const headingScrollSpy = vi.fn()
  heading.scrollIntoView = headingScrollSpy
  article.appendChild(heading)

  // 20 filler paragraphs so the highlight sits far below the heading
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('p')
    p.textContent = `Filler paragraph ${i + 1}`
    article.appendChild(p)
  }

  const highlightPara = document.createElement('p')
  const highlightSpan = document.createElement('span')
  highlightSpan.setAttribute('data-comment-highlight', '7')
  highlightSpan.textContent = 'shipping are two distinct problems'
  const spanScrollSpy = vi.fn()
  highlightSpan.scrollIntoView = spanScrollSpy
  highlightPara.appendChild(highlightSpan)
  article.appendChild(highlightPara)

  document.body.appendChild(article)
  return { spanScrollSpy, headingScrollSpy, highlightSpan, heading }
}

describe('<CommentsPanel> — Jump to lands on the highlighted text', () => {
  beforeEach(() => {
    getCommentsMock.mockClear()
    useStore.setState({ activeDocId: 1, toc: [{ id: 'why-md-reader-exists', text: 'Why md-reader exists', level: 2 }] })
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('scrolls to the inline [data-comment-highlight] span, not the section heading', async () => {
    const { spanScrollSpy, headingScrollSpy } = buildArticle()
    render(<CommentsPanel onClose={() => {}} />)

    // Wait for the async getComments to populate and the Jump button to render
    const jumpBtn = await waitFor(() => screen.getByTitle(/jump to highlighted text|jump to section/i))
    expect(jumpBtn.getAttribute('title')).toMatch(/jump to highlighted text/i)
    fireEvent.click(jumpBtn)

    await waitFor(() => expect(spanScrollSpy).toHaveBeenCalledTimes(1))
    const call = spanScrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined
    expect(call?.block).toBe('center')  // centered on the highlight, not aligned to top
    expect(headingScrollSpy).not.toHaveBeenCalled()
  })

  it('applies a teal outline flash to the highlighted span', async () => {
    const { highlightSpan } = buildArticle()
    render(<CommentsPanel onClose={() => {}} />)

    const jumpBtn = await waitFor(() => screen.getByTitle(/jump to highlighted text/i))
    fireEvent.click(jumpBtn)

    await waitFor(() => expect(highlightSpan.style.outline.length).toBeGreaterThan(0))
    expect(highlightSpan.style.outline).toMatch(/2dd4bf|2px/)
  })

  it('clicking the quoted-text block also jumps to the highlight', async () => {
    const { spanScrollSpy, headingScrollSpy } = buildArticle()
    render(<CommentsPanel onClose={() => {}} />)

    const quoteBtn = await waitFor(() => screen.getByTestId('comment-quote-jump'))
    fireEvent.click(quoteBtn)

    await waitFor(() => expect(spanScrollSpy).toHaveBeenCalledTimes(1))
    expect(headingScrollSpy).not.toHaveBeenCalled()
  })

  it('collapses the Your-name field to an avatar chip and expands to an input on click', async () => {
    buildArticle()
    localStorage.setItem('md-reader-username', 'Ada Lovelace')
    render(<CommentsPanel onClose={() => {}} />)

    // Chip is visible, input is not
    const chip = await waitFor(() => screen.getByTestId('username-chip'))
    expect(chip).toBeInTheDocument()
    expect(chip.getAttribute('title')).toMatch(/Ada Lovelace/)
    expect(screen.queryByTestId('username-input')).not.toBeInTheDocument()

    // Click expands to input
    fireEvent.click(chip)
    const input = await screen.findByTestId('username-input')
    expect(input).toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('Ada Lovelace')

    // Pressing Enter collapses back to chip
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('username-input')).not.toBeInTheDocument())
    expect(screen.getByTestId('username-chip')).toBeInTheDocument()
  })

  it('renders comment actions as icon-only buttons with tooltips, and hides Delete behind the overflow menu', async () => {
    buildArticle()
    render(<CommentsPanel onClose={() => {}} />)

    // Jump + Resolve are visible as icon-only buttons; Delete is not visible yet
    await waitFor(() => screen.getByTitle(/jump to highlighted text/i))
    expect(screen.getByTitle(/jump to highlighted text/i)).toBeInTheDocument()
    expect(screen.getByTitle(/resolve comment/i)).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete comment/i })).not.toBeInTheDocument()

    // Jump button should be icon-only (no visible text label)
    const jump = screen.getByTitle(/jump to highlighted text/i)
    expect(jump.textContent?.trim()).toBe('')

    // Opening the overflow menu reveals Delete
    const overflowBtn = screen.getByRole('button', { name: /more actions/i })
    fireEvent.click(overflowBtn)
    const deleteItem = await screen.findByRole('menuitem', { name: /delete comment/i })
    expect(deleteItem).toBeInTheDocument()
  })

  it('falls back to the section heading when the inline span is missing', async () => {
    const { spanScrollSpy, headingScrollSpy } = buildArticle()
    // Remove the highlight span before the click to simulate missing/stale text
    document.querySelector('[data-comment-highlight="7"]')?.remove()

    render(<CommentsPanel onClose={() => {}} />)
    const jumpBtn = await waitFor(() => screen.getByTitle(/jump to highlighted text|jump to section/i))
    fireEvent.click(jumpBtn)

    // Handler retries 8× at 120ms each (~1s) before falling back
    await waitFor(() => expect(headingScrollSpy).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(spanScrollSpy).not.toHaveBeenCalled()
    const call = headingScrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined
    expect(call?.block).toBe('start')  // heading aligned to top of viewport
  })
})
