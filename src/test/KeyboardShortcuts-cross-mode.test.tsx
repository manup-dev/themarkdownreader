/**
 * B9 follow-up — cross-mode isolation regression test.
 *
 * Context: KeyboardShortcuts-crash-guard.test.tsx pins that toggling a
 * reading mode off (or a content change) never crashes React by restoring
 * the exact original DOM node identity (see restoreTrackedTextNodes in
 * KeyboardShortcuts.tsx). That fix did NOT by itself prevent a separate,
 * silent bug: bionic and heatmap are independent toggles that can both be
 * active at once, and their tree-walkers originally walked over whatever
 * text nodes currently existed under <article> — including text nodes the
 * OTHER mode had already wrapped in its own span. That produced nested
 * markup (e.g. a `[data-bionic]` span inside a `[data-freq-highlight]`
 * span). Toggling the OUTER mode off removed its entire inserted subtree,
 * including any nested markup the INNER mode had put there — silently
 * deleting part of a still-active, unrelated reading mode with no crash and
 * no user-visible signal.
 *
 * First fix (span-count tests below): each mode's text-node walker skips
 * text already owned by the OTHER mode's live spans (bionic skips
 * `[data-freq-highlight]` descendants; heatmap skips `[data-bionic]`
 * descendants), so their SPANS never nest. That alone was NOT sufficient —
 * see the "text content" describe block below for the bug it missed and how
 * it was actually fixed. Keeping the original span-count tests here too:
 * they pin a real (if narrower) property — spans never nest — that the
 * current implementation still needs to hold.
 *
 * The trade-off (still true, see "text content" tests for verification):
 * whichever mode is turned on SECOND will not re-style text the first mode
 * already claimed (e.g. bionic-bolded words won't also get
 * heatmap-highlighted) — an intentional, safe restriction, not a bug. That
 * trade-off is asymmetric: bionic claims virtually every word (anything 3+
 * letters outside headings), so enabling bionic FIRST leaves heatmap almost
 * nothing to highlight in the body text — but headings are exempt from
 * bionic (it explicitly skips h1-h6) and NOT exempt from heatmap, so a
 * repeated term that also appears in a heading always gives heatmap at
 * least one guaranteed, order-independent highlight to verify against.
 *
 * Uses the same real-<Reader/>-rendering approach as
 * KeyboardShortcuts-crash-guard.test.tsx (not synthetic DOM) because both
 * bugs only reproduce against actual react-markdown output.
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

  it('toggling heatmap OFF leaves bionic active and covering at least as much as before (heatmap enabled first)', () => {
    // NOTE: bionic's span COUNT is allowed to INCREASE here relative to
    // "while heatmap was still nested" — see the "B9 second follow-up"
    // describe block below for why (full-unwind-and-reapply lets bionic
    // re-expand into territory heatmap had exclusively claimed, which is
    // the correct behavior once heatmap is gone, not a bug). The strict,
    // byte-exact assertion lives there (compares against a bionic-only
    // baseline's full text content). This test just pins the coarser
    // invariant: heatmap's spans are fully gone, and bionic's are not lost.
    renderApp()
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' })
    const bionicCountBefore = document.querySelectorAll('[data-bionic]').length
    expect(bionicCountBefore).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'h' }) // heatmap off — bionic stays on

    expect(document.querySelectorAll('[data-freq-highlight]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThanOrEqual(bionicCountBefore)
  })

  it('heatmap spans never nest inside bionic spans (bionic enabled first)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    expect(document.querySelectorAll('[data-bionic]').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'h' })

    expect(document.querySelectorAll('[data-bionic] [data-freq-highlight]')).toHaveLength(0)
  })

  it('toggling bionic OFF leaves heatmap active and covering at least as much as before (bionic enabled first)', () => {
    // NOTE (mirrors the test above): heatmap's span count is allowed to
    // INCREASE once bionic is gone — full-unwind-and-reapply lets heatmap
    // re-expand into body-text territory bionic had exclusively claimed.
    // The byte-exact assertion lives in the "B9 second follow-up" describe
    // block below.
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
    expect(document.querySelectorAll('[data-freq-highlight]').length).toBeGreaterThanOrEqual(heatmapCountBefore)
  })
})

describe('B9 second follow-up — cross-mode off-toggle must not duplicate/garble visible text', () => {
  // The span-count tests above (first fix: mutual-exclusion skip selectors)
  // proved spans never NEST. They did NOT catch a worse bug the same fix
  // introduced: a mode-scoped restore (`restoreTrackedTextNodes('heatmap')`,
  // say) can leave the DOM with visibly DUPLICATED text, because heatmap's
  // own mutation record can list plain-text pieces that bionic has SINCE
  // replaced again (those pieces sit outside any `[data-freq-highlight]`
  // span, so bionic's skip check doesn't exclude them — only the highlight
  // SPANS themselves are protected from nesting, not the plain-text
  // siblings heatmap's single mutation record also produced). When heatmap
  // is toggled off alone, those already-detached pieces silently fail to
  // remove, but heatmap's full original text still gets unconditionally
  // reinserted anyway — landing right next to bionic's still-live
  // replacement for the same substring. Reproduced directly against this
  // file's own MD content before fixing:
  //   BEFORE:      Some wonderful wonderful content about wonderful things...
  //   AFTER h-off: Some  content about  things...Some wonderful wonderful
  //                content about wonderful things...
  // (the whole sentence duplicated, interleaved with mangled leftover
  // markup). Fixed by having the off-toggle fully unwind EVERY tracked
  // mutation (the same primitive Escape/clearReadingModes already prove
  // correct) instead of a mode-filtered partial unwind, then re-applying
  // the still-active mode fresh against the now-pristine DOM.
  //
  // These tests check `article.textContent` directly — not element counts —
  // against a same-markdown, single-mode-only baseline rendered fresh in
  // the same test. That baseline is the ground truth: it's exactly what the
  // user should see after the off-toggle, since only one mode is left
  // active either way.
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

  it('heatmap-on, bionic-on, heatmap-off: text is byte-identical to a bionic-only render (no duplication)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'h' }) // heatmap off — bionic stays on
    const afterCombined = document.querySelector('article')!.textContent

    cleanup()
    document.body.innerHTML = ''
    renderApp()
    fireEvent.keyDown(window, { key: 'b' }) // bionic-only baseline, fresh render
    const bionicOnlyBaseline = document.querySelector('article')!.textContent

    expect(afterCombined).toBe(bionicOnlyBaseline)
  })

  it('bionic-on, heatmap-on, bionic-off: text is byte-identical to a heatmap-only render (no duplication)', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' }) // bionic off — heatmap stays on
    const afterCombined = document.querySelector('article')!.textContent

    cleanup()
    document.body.innerHTML = ''
    renderApp()
    fireEvent.keyDown(window, { key: 'h' }) // heatmap-only baseline, fresh render
    const heatmapOnlyBaseline = document.querySelector('article')!.textContent

    expect(afterCombined).toBe(heatmapOnlyBaseline)
  })

  it('heatmap-on, bionic-on, heatmap-off: also matches the pristine pre-mode text content-wise (sanity check)', () => {
    renderApp()
    const pristine = document.querySelector('article')!.textContent
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'h' })
    fireEvent.keyDown(window, { key: 'b' }) // both off now
    const afterBothOff = document.querySelector('article')!.textContent
    expect(afterBothOff).toBe(pristine)
  })
})
