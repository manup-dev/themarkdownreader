/**
 * B9 crash-guard regression test — reproduces the white-screen crash
 * against REAL react-markdown-owned DOM, not synthetic document.createElement
 * nodes.
 *
 * Why a separate file / different render strategy than KeyboardShortcuts.test.tsx:
 * that file's seedDom() builds `<article>`/`<h2>`/`<p>` via plain DOM calls
 * appended to document.body — those nodes are never owned by React's
 * reconciler, so they can prove the store-subscription *fires* and clears
 * elements, but cannot prove the actual NotFoundError crash is prevented,
 * because there's no real fiber tree to reconcile against. This file renders
 * the actual <Reader/> component (which owns the <article> and renders it via
 * react-markdown) together with <KeyboardShortcuts/>, so the DOM nodes bionic
 * mutates are genuinely React-owned and fiber-tracked.
 *
 * What actually reproduces the crash: a paragraph that contains inline
 * formatting (bold, a link) renders as MULTIPLE sibling children under <p>
 * (several HostText fibers, not one). Bionic's word-boldening walks every
 * Text node under <article> and replaces each with a DocumentFragment via
 * `parent.replaceChild(frag, node)` — this detaches the ORIGINAL Text node
 * that React's fiber still references. If the "restore" step ever creates a
 * *new* text node with equivalent content (rather than re-inserting the
 * exact same node object), React's fiber keeps pointing at the old,
 * permanently-detached node. The next time React needs to reconcile that
 * paragraph's children as an array (which only happens when the child SHAPE
 * differs across renders — e.g. inline formatting is added/removed, not a
 * same-shape retained update) it calls `parentNode.removeChild(staleNode)`
 * and the browser throws:
 *   NotFoundError: The node to be removed is not a child of this node.
 * A markdown change to plain, single-child paragraphs (no inline
 * formatting) does NOT trigger this — React can just overwrite the parent's
 * `.textContent` directly, bypassing per-child reconciliation entirely. This
 * is exactly why the ORIGINAL fix (commit f1f7dfb), which only changed
 * *when* cleanup ran (synchronously in the store subscription) but not
 * *what* it restored (a brand-new text node, not the original), still
 * crashed under this repro — confirmed by temporarily reverting to that
 * version and re-running this exact test before implementing the real fix
 * (restoreTrackedTextNodes keeps the original DOM node identity intact).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { Reader } from '../components/Reader'
import { KeyboardShortcuts } from '../components/KeyboardShortcuts'
import { MdReaderProvider } from '../provider/MdReaderProvider'
import { useStore } from '../store/useStore'
import type { StorageAdapter } from '../types/storage-adapter'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))

// jsdom does not implement IntersectionObserver — Reader uses it to track
// which heading is topmost in view. A no-op stub is enough for this test.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver

// activeDocId stays null in every test here, so Reader's comment/highlight
// effects short-circuit before ever calling the adapter (see Reader.tsx:
// `if (!activeDocId) { ...; return }` ahead of every adapter.get*() call) —
// an empty stub is sufficient, no need to mock individual methods.
const mockAdapter = {} as unknown as StorageAdapter

// Paragraphs contain inline formatting (bold + link) so each renders as
// MULTIPLE text-node children under <p> — the shape react-markdown actually
// produces for any real-world formatted document, and the specific shape
// needed to reproduce the crash (see file header).
const MD_WITH_INLINE_FORMATTING =
  '# One\n\nSome **paragraph** content with enough words here to bold nicely, and a [link](https://example.com) too.\n\n' +
  '# Two\n\nMore body text here as well, also **bold** and a [link](https://example.com/two) again.'

const MD_REPLACEMENT_PLAIN =
  '# One\n\nA totally different plain sentence with no formatting at all here.\n\n' +
  '# Two\n\nAnother totally different plain sentence with no formatting either.'

function renderApp() {
  return render(
    <MdReaderProvider adapter={mockAdapter}>
      <Reader />
      <KeyboardShortcuts />
    </MdReaderProvider>,
  )
}

describe('B9 crash guard — real react-markdown-owned DOM', () => {
  beforeEach(() => {
    useStore.setState({
      markdown: MD_WITH_INLINE_FORMATTING,
      fileName: 'doc.md',
      viewMode: 'read',
      activeSection: null,
      activeDocId: null,
      toc: [],
      enabledFeatures: new Set<string>(),
    })
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('does not throw NotFoundError when the document changes while bionic mode is on', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)

    expect(() => {
      act(() => {
        useStore.setState({ markdown: MD_REPLACEMENT_PLAIN })
      })
    }).not.toThrow()

    // The guard must have cleared the stale bionic markup, and React must
    // have gone on to render the new content without a crashed tree.
    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(0)
    expect(document.querySelector('article')?.textContent ?? '').toContain('totally different plain sentence')
  })

  it('does not throw NotFoundError when the document changes while heatmap mode is on', () => {
    // Heatmap only highlights terms that repeat 3+ times — pad the doc so at
    // least one term clears that bar.
    useStore.setState({
      markdown:
        '# One\n\nSome **wonderful** wonderful content about wonderful things, and a [link](https://x.com) too.\n\n' +
        '# Two\n\nMore wonderful body text here, also **wonderful** and a [link](https://x.com/2) again.',
    })
    renderApp()
    fireEvent.keyDown(window, { key: 'h' })
    expect(document.querySelectorAll('[data-freq-highlight]').length).toBeGreaterThan(0)

    expect(() => {
      act(() => {
        useStore.setState({ markdown: MD_REPLACEMENT_PLAIN })
      })
    }).not.toThrow()

    expect(document.querySelectorAll('[data-freq-highlight]')).toHaveLength(0)
  })

  it('toggling bionic off restores the exact original nodes so a later markdown change still does not crash', () => {
    // Regression for the toggle-off path itself (not just the store-change
    // guard): the pre-fix off-toggle also created brand-new text nodes
    // instead of restoring originals, so this sequence — bionic on, bionic
    // off via a second `b`, THEN a markdown change — could crash even
    // without ever going through clearReadingModes().
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(0)

    expect(() => {
      act(() => {
        useStore.setState({ markdown: MD_REPLACEMENT_PLAIN })
      })
    }).not.toThrow()
  })
})
