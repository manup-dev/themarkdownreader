/**
 * B9 follow-up — cross-mode isolation regression test.
 *
 * Context: KeyboardShortcuts-crash-guard.test.tsx pins that toggling a
 * reading mode off (or a content change) never crashes React by restoring
 * the exact original DOM node identity (see restoreTrackedTextNodes in
 * KeyboardShortcuts.tsx). That fix does NOT by itself prevent a separate,
 * silent bug: bionic and heatmap are independent toggles that can both be
 * active at once, and their tree-walkers used to walk over whatever text
 * nodes currently exist under <article> — including text nodes the OTHER
 * mode had already wrapped in its own span. That produced nested markup
 * (e.g. a `[data-bionic]` span inside a `[data-freq-highlight]` span).
 * Toggling the OUTER mode off removes its entire inserted subtree,
 * including any nested markup the INNER mode had put there — silently
 * deleting part of a still-active, unrelated reading mode with no crash and
 * no user-visible signal.
 *
 * Fix: each mode's text-node walker now skips text already owned by the
 * OTHER mode's live spans (bionic skips `[data-freq-highlight]` descendants;
 * heatmap skips `[data-bionic]` descendants). This prevents nesting from
 * ever happening, in either activation order, so neither mode's off-toggle
 * can ever remove the other mode's markup. The trade-off: whichever mode is
 * turned on SECOND will not re-style text the first mode already claimed
 * (e.g. bionic-bolded words won't also get heatmap-highlighted) — an
 * intentional, safe restriction, not a bug. That trade-off is asymmetric:
 * bionic claims virtually every word (anything 3+ letters outside headings),
 * so enabling bionic FIRST leaves heatmap almost nothing to highlight in the
 * body text — but headings are exempt from bionic (it explicitly skips
 * h1-h6) and NOT exempt from heatmap, so a repeated term that also appears
 * in a heading always gives heatmap at least one guaranteed, order-
 * independent highlight to verify against.
 *
 * Uses the same real-<Reader/>-rendering approach as
 * KeyboardShortcuts-crash-guard.test.tsx (not synthetic DOM) because the
 * nesting bug only reproduces against actual react-markdown output.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
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

// activeDocId stays null, so Reader's comment/highlight effects short-circuit
// before calling the adapter — an empty stub is sufficient.
const mockAdapter = {} as unknown as StorageAdapter

// A repeated word ("wonderful", 4+ letters, 3+ occurrences) so heatmap has
// something to highlight, plus inline bold/link formatting so bionic and
// heatmap both have plenty of text nodes to walk and a realistic chance to
// overlap/nest without the fix. "Wonderful" also appears in BOTH headings —
// bionic explicitly skips h1-h6, so those occurrences stay highlightable by
// heatmap regardless of activation order (see file header comment).
const MD =
  '# One Wonderful Intro\n\nSome wonderful wonderful content about wonderful things, and a [link](https://x.com) too, ' +
  'with **bold** words mixed in for good measure and more wonderful text.\n\n' +
  '# Two More Wonderful Stuff\n\nMore wonderful body text here, also **bold** and a [link](https://x.com/2) again, ' +
  'wonderful indeed with plenty more wonderful padding words.'

function renderApp() {
  return render(
    <MdReaderProvider adapter={mockAdapter}>
      <Reader />
      <KeyboardShortcuts />
    </MdReaderProvider>,
  )
}

describe('B9 follow-up — cross-mode isolation (heatmap + bionic simultaneously active)', () => {
  beforeEach(() => {
    useStore.setState({
      markdown: MD,
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

  it('bionic spans never nest inside heatmap spans (heatmap enabled first)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'h' })
    expect(document.querySelectorAll('[data-freq-highlight]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)

    expect(document.querySelectorAll('[data-freq-highlight] [data-bionic]')).toHaveLength(0)
  })

  it('toggling heatmap OFF leaves every bionic span intact (heatmap enabled first)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' })
    const bionicCountBefore = document.querySelectorAll('[data-bionic]').length
    expect(bionicCountBefore).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'h' }) // heatmap off — bionic stays on

    expect(document.querySelectorAll('[data-freq-highlight]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(bionicCountBefore)
  })

  it('heatmap spans never nest inside bionic spans (bionic enabled first)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'h' })

    expect(document.querySelectorAll('[data-bionic] [data-freq-highlight]')).toHaveLength(0)
  })

  it('toggling bionic OFF leaves every heatmap span intact (bionic enabled first)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'h' })
    // Bionic (enabled first) claims virtually every body word, so heatmap's
    // guaranteed highlights here come from the heading occurrences of
    // "wonderful" — bionic explicitly skips h1-h6, heatmap does not.
    const heatmapCountBefore = document.querySelectorAll('[data-freq-highlight]').length
    expect(heatmapCountBefore).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'b' }) // bionic off — heatmap stays on

    expect(document.querySelectorAll('[data-bionic]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-freq-highlight]')).toHaveLength(heatmapCountBefore)
  })
})
