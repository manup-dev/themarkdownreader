/**
 * Pins B12: the reading streak is (a) written from an effect, never during
 * render, and (b) only bumped when words were actually read that day —
 * merely visiting the upload screen no longer extends a streak.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Upload } from '../components/Upload'
import { useStore } from '../store/useStore'
import { MdReaderProvider } from '../provider/MdReaderProvider'
import { recordWordsRead } from '../lib/reading-metrics'
import type { StorageAdapter } from '../types/storage-adapter'

const mockAdapter = { addDocument: vi.fn() } as unknown as StorageAdapter
function renderUpload() {
  return render(<MdReaderProvider adapter={mockAdapter}><Upload /></MdReaderProvider>)
}

describe('<Upload> reading streak (B12)', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ markdown: '', fileName: null, workspaceMode: false, folderFiles: null })
  })
  afterEach(() => cleanup())

  it('does NOT bump the streak on a mere visit (no words read today)', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toDateString()
    localStorage.setItem('md-reader-docs-read', '5')
    localStorage.setItem('md-reader-streak', '3')
    localStorage.setItem('md-reader-streak-date', twoDaysAgo)
    renderUpload()
    expect(localStorage.getItem('md-reader-streak')).toBe('3')
    expect(localStorage.getItem('md-reader-streak-date')).toBe(twoDaysAgo)
  })

  it('extends the streak when words were actually read today (consecutive day)', () => {
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    localStorage.setItem('md-reader-docs-read', '5')
    localStorage.setItem('md-reader-streak', '3')
    localStorage.setItem('md-reader-streak-date', yesterday)
    recordWordsRead('42', 250)
    renderUpload()
    expect(localStorage.getItem('md-reader-streak')).toBe('4')
    expect(localStorage.getItem('md-reader-streak-date')).toBe(new Date().toDateString())
  })

  it('restarts at 1 after a gap day (words read today, last read 3 days ago)', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toDateString()
    localStorage.setItem('md-reader-docs-read', '5')
    localStorage.setItem('md-reader-streak', '9')
    localStorage.setItem('md-reader-streak-date', threeDaysAgo)
    recordWordsRead('42', 250)
    renderUpload()
    expect(localStorage.getItem('md-reader-streak')).toBe('1')
  })
})
