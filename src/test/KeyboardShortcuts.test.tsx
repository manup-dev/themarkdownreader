/**
 * Pins the KeyboardShortcuts correctness fixes:
 *  - B5: scroll shortcuts (Shift+G, gg) act on the reader scroll container
 *        inside #main-content, never the sidebar's overflow-y-auto pane
 *  - B6: space-hold glance prevents default synchronously (incl. key repeats)
 *  - B9: Escape clears word-count badges too; a document change clears all
 *        DOM reading modes synchronously (before React re-commits)
 *  - B10: TL;DR off-toggle fully tears down heading cursor/title/handlers
 *  - B11: keyboard_shortcut telemetry fires only for keys a shortcut handled
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { KeyboardShortcuts } from '../components/KeyboardShortcuts'
import { useStore } from '../store/useStore'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))
const trackEventMock = trackEvent as unknown as ReturnType<typeof vi.fn>

const MD = '# One\n\nSome paragraph content with enough words here.\n\n# Two\n\nMore body text.'

function seedDom() {
  // Sidebar pane — matches [class*="overflow-y-auto"] and sits BEFORE
  // #main-content in the DOM, exactly like OutlinePanel/FileExplorer do.
  const sidebar = document.createElement('aside')
  sidebar.className = 'flex-1 overflow-y-auto px-2'
  ;(sidebar as unknown as { scrollTo: unknown }).scrollTo = vi.fn()
  document.body.appendChild(sidebar)

  // Reader scroll container inside #main-content (App.tsx renders
  // <div id="main-content"> around Reader, whose root div is overflow-y-auto).
  const main = document.createElement('div')
  main.id = 'main-content'
  const readerScroll = document.createElement('div')
  readerScroll.className = 'flex-1 overflow-y-auto'
  ;(readerScroll as unknown as { scrollTo: unknown }).scrollTo = vi.fn()
  const article = document.createElement('article')
  const h2 = document.createElement('h2')
  h2.textContent = 'Section one'
  const p = document.createElement('p')
  p.textContent = 'Some paragraph content with enough words here to badge and bold.'
  article.append(h2, p)
  readerScroll.appendChild(article)
  main.appendChild(readerScroll)
  document.body.appendChild(main)
  return { sidebar, readerScroll, article, h2, p }
}

describe('<KeyboardShortcuts>', () => {
  let dom: ReturnType<typeof seedDom>

  beforeEach(() => {
    trackEventMock.mockClear()
    useStore.setState({
      markdown: MD,
      viewMode: 'read',
      activeSection: 'one',
      toc: [
        { id: 'one', text: 'One', level: 1 },
        { id: 'two', text: 'Two', level: 1 },
      ],
      enabledFeatures: new Set<string>(),
    })
    dom = seedDom()
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    document.body.className = ''
  })

  it('B5: Shift+G scrolls the #main-content reader pane, not the sidebar', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'G', shiftKey: true })
    expect(dom.readerScroll.scrollTo).toHaveBeenCalledTimes(1)
    expect(dom.sidebar.scrollTo).not.toHaveBeenCalled()
  })

  it('B5: gg (double-tap) scrolls the reader pane to top, not the sidebar', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'g' })
    expect(dom.readerScroll.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(dom.sidebar.scrollTo).not.toHaveBeenCalled()
  })

  it('B6: Space keydown is prevented synchronously in read view (glance armed)', () => {
    render(<KeyboardShortcuts />)
    // fireEvent returns false when preventDefault() was called
    expect(fireEvent.keyDown(window, { key: ' ' })).toBe(false)
  })

  it('B6: held-Space repeat events are also prevented (no scroll under preview)', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(fireEvent.keyDown(window, { key: ' ', repeat: true })).toBe(false)
  })

  it('B9: Escape clears bionic spans, heatmap spans, AND word-count badges', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'w' })
    expect(document.querySelectorAll('[data-word-count-badge]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-freq-highlight]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-word-count-badge]')).toHaveLength(0)
  })

  it('B9: changing the document clears DOM reading modes synchronously', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)
    act(() => {
      useStore.setState({ markdown: '# Completely different document' })
    })
    // Cleared by the synchronous store subscription — BEFORE React would
    // reconcile the react-markdown tree and hit NotFoundError.
    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(0)
  })

  it('B10: TL;DR off-toggle restores heading cursor, title, and body visibility', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'd' })
    expect(dom.p.style.display).toBe('none')
    expect(dom.h2.style.cursor).toBe('pointer')
    expect(dom.h2.title).toBe('Click to expand this section')
    fireEvent.keyDown(window, { key: 'd' })
    expect(dom.p.style.display).toBe('')
    expect(dom.h2.style.cursor).toBe('')   // previously leaked as 'pointer'
    expect(dom.h2.title).toBe('')          // previously leaked tooltip
    expect(dom.article.classList.contains('tldr-mode')).toBe(false)
  })

  it('B11: unbound keys do not fire keyboard_shortcut telemetry; handled keys do', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'q' })
    expect(trackEventMock.mock.calls.filter(([e]) => e === 'keyboard_shortcut')).toHaveLength(0)
    fireEvent.keyDown(window, { key: '?' })
    expect(trackEventMock.mock.calls.filter(([e]) => e === 'keyboard_shortcut')).toHaveLength(1)
  })
})
