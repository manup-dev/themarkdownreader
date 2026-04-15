import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OutlinePanel } from '../components/OutlinePanel'
import { useStore } from '../store/useStore'

describe('<OutlinePanel>', () => {
  beforeEach(() => {
    // Polyfill IntersectionObserver (used by useActiveSection)
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
    useStore.setState({ toc: [], markdown: '', fileName: null })
  })

  it('renders empty-state when toc is empty', () => {
    render(<OutlinePanel />)
    // Should show a message about no headings
    expect(screen.getByText(/no headings/i)).toBeInTheDocument()
  })

  it('renders heading entries from store.toc', () => {
    useStore.setState({
      toc: [
        { id: 'intro', text: 'Introduction', level: 1 },
        { id: 'setup', text: 'Setup', level: 2 },
        { id: 'api', text: 'API', level: 2 },
      ],
      markdown: '# Introduction\n## Setup\n## API',
    })
    render(<OutlinePanel />)
    expect(screen.getByText('Introduction')).toBeInTheDocument()
    expect(screen.getByText('Setup')).toBeInTheDocument()
    expect(screen.getByText('API')).toBeInTheDocument()
  })

  it('wraps the heading list in a nav with accessible label', () => {
    useStore.setState({
      toc: [{ id: 'a', text: 'A', level: 1 }],
    })
    render(<OutlinePanel />)
    expect(screen.getByRole('navigation', { name: /outline|contents/i })).toBeInTheDocument()
  })

  it('indents entries by heading level via inline padding', () => {
    useStore.setState({
      toc: [
        { id: 'a', text: 'Level1', level: 1 },
        { id: 'b', text: 'Level2', level: 2 },
        { id: 'c', text: 'Level3', level: 3 },
      ],
    })
    render(<OutlinePanel />)
    const l1 = screen.getByText('Level1').closest('button')
    const l2 = screen.getByText('Level2').closest('button')
    const l3 = screen.getByText('Level3').closest('button')
    expect(l1).toBeTruthy()
    expect(l2).toBeTruthy()
    expect(l3).toBeTruthy()
    // Padding should be computed from level; level 2 > level 1, level 3 > level 2
    const pad = (el: HTMLElement | null) =>
      el ? parseFloat(el.style.paddingLeft || '0') : 0
    expect(pad(l2)).toBeGreaterThan(pad(l1))
    expect(pad(l3)).toBeGreaterThan(pad(l2))
  })
})
