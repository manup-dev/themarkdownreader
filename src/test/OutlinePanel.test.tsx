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

  it('indents entries by heading level via inline padding (h1 vs h2)', () => {
    useStore.setState({
      toc: [
        { id: 'a', text: 'Level1', level: 1 },
        { id: 'b', text: 'Level2', level: 2 },
      ],
    })
    render(<OutlinePanel />)
    const l1 = screen.getByText('Level1').closest('button')
    const l2 = screen.getByText('Level2').closest('button')
    expect(l1).toBeTruthy()
    expect(l2).toBeTruthy()
    const pad = (el: HTMLElement | null) =>
      el ? parseFloat(el.style.paddingLeft || '0') : 0
    expect(pad(l2)).toBeGreaterThan(pad(l1))
  })

  it('filters out headings deeper than maxLevel (default 2 matches Reader baseline)', () => {
    useStore.setState({
      toc: [
        { id: 'a', text: 'ShownH1', level: 1 },
        { id: 'b', text: 'ShownH2', level: 2 },
        { id: 'c', text: 'HiddenH3', level: 3 },
        { id: 'd', text: 'HiddenH4', level: 4 },
      ],
    })
    render(<OutlinePanel />)
    expect(screen.getByText('ShownH1')).toBeInTheDocument()
    expect(screen.getByText('ShownH2')).toBeInTheDocument()
    expect(screen.queryByText('HiddenH3')).toBeNull()
    expect(screen.queryByText('HiddenH4')).toBeNull()
  })

  it('maxLevel prop override lets h3+ through', () => {
    useStore.setState({
      toc: [
        { id: 'a', text: 'H1', level: 1 },
        { id: 'c', text: 'H3', level: 3 },
      ],
    })
    render(<OutlinePanel maxLevel={6} />)
    expect(screen.getByText('H1')).toBeInTheDocument()
    expect(screen.getByText('H3')).toBeInTheDocument()
  })
})
