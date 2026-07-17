/**
 * Pins B4: programmatic prefill flows through store state
 * (pendingChatInput / pendingSearchQuery), not DOM event dispatch —
 * synthetic 'input' events are swallowed by React's controlled-input
 * value tracker, and the old selectors queried placeholders that don't
 * exist in the live DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { useStore } from '../store/useStore'
import { SearchOverlay } from '../components/SearchOverlay'
import { Chat } from '../components/Chat'

// Chat mounts backend detection on render — stub the whole ai surface so no
// network/model code runs in jsdom (same failure class as the AiSettings flake).
vi.mock('../lib/ai', () => ({
  askAboutDocument: vi.fn(async () => 'answer'),
  summarize: vi.fn(async () => 'summary'),
  detectBestBackend: vi.fn(async () => 'ollama'),
  getActiveBackend: vi.fn(() => 'ollama'),
  isBackendReady: vi.fn(() => true),
  onBackendChange: vi.fn(() => () => {}),
  onWebLLMProgress: vi.fn(),
  onModelProgress: vi.fn(() => () => {}),
}))

describe('pendingSearchQuery → SearchOverlay (B4)', () => {
  beforeEach(() => {
    useStore.setState({
      markdown: '# Doc\n\nthe needle is in here',
      viewMode: 'read',
      pendingSearchQuery: null,
    })
    const article = document.createElement('article')
    const p = document.createElement('p')
    p.textContent = 'the needle is in here'
    article.appendChild(p)
    document.body.appendChild(article)
  })
  afterEach(() => {
    cleanup()
    document.querySelectorAll('article').forEach((a) => a.remove())
  })

  it('opens the overlay prefilled, runs the search, and clears the pending field', async () => {
    useStore.setState({ pendingSearchQuery: 'needle' })
    render(<SearchOverlay />)
    const input = await screen.findByLabelText('Search document') as HTMLInputElement
    expect(input.value).toBe('needle')
    expect(useStore.getState().pendingSearchQuery).toBeNull()
    expect(document.querySelector('[data-search-highlight]')).not.toBeNull()
  })
})

describe('pendingChatInput → Chat (B4)', () => {
  beforeEach(() => {
    useStore.setState({
      markdown: '# Doc\n\nsome content',
      chatMessages: [],
      pendingChatInput: null,
    })
  })
  afterEach(() => cleanup())

  it('moves the pending text into the chat input and clears the pending field', async () => {
    useStore.setState({ pendingChatInput: 'Explain this passage: "foo"' })
    render(<Chat />)
    await waitFor(() => {
      const input = screen.getByLabelText('Ask a question about this document') as HTMLInputElement
      expect(input.value).toBe('Explain this passage: "foo"')
    })
    expect(useStore.getState().pendingChatInput).toBeNull()
  })
})
