import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActiveSection } from '../hooks/useActiveSection'

describe('useActiveSection', () => {
  beforeEach(() => {
    // Polyfill IntersectionObserver for jsdom
    class MockIO {
      cb: (entries: IntersectionObserverEntry[]) => void
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.cb = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIO as unknown)
  })

  it('returns null when no headings are provided', () => {
    const { result } = renderHook(() => useActiveSection([]))
    expect(result.current).toBeNull()
  })

  it('returns the first heading id as initial value when headings are provided', () => {
    const headings = [
      { id: 'intro', text: 'Intro', level: 1 },
      { id: 'setup', text: 'Setup', level: 2 },
    ]
    const { result } = renderHook(() => useActiveSection(headings))
    expect(result.current).toBe('intro')
  })

  it('handles empty id heading gracefully', () => {
    const headings = [{ id: '', text: 'No ID', level: 1 }]
    const { result } = renderHook(() => useActiveSection(headings))
    // First heading wins even if id is empty string
    expect(result.current).toBe('')
  })
})
