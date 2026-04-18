import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MdReaderProvider } from '../provider/MdReaderProvider'
import { useAdapter, useDocument, useTheme, useViewMode, useChat, useFeatures } from '../provider/hooks'
import type { StorageAdapter } from '../types/storage-adapter'

// Mock adapter with all 31 methods
const mockAdapter = {
  addDocument: vi.fn(),
  getDocument: vi.fn(),
  removeDocument: vi.fn(),
  getAllDocuments: vi.fn(),
  getDocStats: vi.fn(),
  finalizeImport: vi.fn(),
  addHighlight: vi.fn(),
  getHighlights: vi.fn(),
  removeHighlight: vi.fn(),
  updateHighlightNote: vi.fn(),
  updateHighlightColor: vi.fn(),
  addComment: vi.fn(),
  getComments: vi.fn(),
  updateComment: vi.fn(),
  removeComment: vi.fn(),
  getCommentCount: vi.fn(),
  searchAcrossDocuments: vi.fn(),
  getAnalysis: vi.fn(),
  saveAnalysis: vi.fn(),
  getAnalysisByDocId: vi.fn(),
  clearAnalyses: vi.fn(),
  getCachedAudio: vi.fn(),
  cacheAudioSegment: vi.fn(),
  getFullCachedAudio: vi.fn(),
  saveCollectionCache: vi.fn(),
  loadCollectionCache: vi.fn(),
  getDocLinks: vi.fn(),
  computeCommunities: vi.fn(),
  computeUmapProjection: vi.fn(),
  exportLibrary: vi.fn(),
  importLibrary: vi.fn(),
  clearAllData: vi.fn(),
  requestPersistentStorage: vi.fn(),
} as unknown as StorageAdapter

const wrapper = ({ children }: { children: ReactNode }) => (
  <MdReaderProvider adapter={mockAdapter}>{children}</MdReaderProvider>
)

describe('useAdapter', () => {
  it('returns the adapter from context when inside MdReaderProvider', () => {
    const { result } = renderHook(() => useAdapter(), { wrapper })
    expect(result.current).toBe(mockAdapter)
  })

  it('throws when used outside MdReaderProvider', () => {
    expect(() => {
      renderHook(() => useAdapter())
    }).toThrow('useAdapter must be used within MdReaderProvider')
  })
})

describe('useDocument', () => {
  it('returns document state properties', () => {
    const { result } = renderHook(() => useDocument(), { wrapper })
    expect(result.current).toHaveProperty('markdown')
    expect(result.current).toHaveProperty('fileName')
    expect(result.current).toHaveProperty('toc')
    expect(result.current).toHaveProperty('activeDocId')
    expect(result.current).toHaveProperty('openDocument')
    expect(result.current).toHaveProperty('setMarkdown')
  })

  it('markdown is a string', () => {
    const { result } = renderHook(() => useDocument(), { wrapper })
    expect(typeof result.current.markdown).toBe('string')
  })

  it('toc is an array', () => {
    const { result } = renderHook(() => useDocument(), { wrapper })
    expect(Array.isArray(result.current.toc)).toBe(true)
  })
})

describe('useTheme', () => {
  it('returns theme state properties', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current).toHaveProperty('theme')
    expect(result.current).toHaveProperty('fontSize')
    expect(result.current).toHaveProperty('dyslexicFont')
    expect(result.current).toHaveProperty('setTheme')
    expect(result.current).toHaveProperty('setFontSize')
    expect(result.current).toHaveProperty('setDyslexicFont')
  })

  it('setTheme is a function', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(typeof result.current.setTheme).toBe('function')
  })

  it('setFontSize is a function', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(typeof result.current.setFontSize).toBe('function')
  })
})

describe('useViewMode', () => {
  it('returns viewMode and setViewMode', () => {
    const { result } = renderHook(() => useViewMode(), { wrapper })
    expect(result.current).toHaveProperty('viewMode')
    expect(result.current).toHaveProperty('setViewMode')
    expect(typeof result.current.setViewMode).toBe('function')
  })
})

describe('useChat', () => {
  it('returns chat state and actions', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    expect(result.current).toHaveProperty('messages')
    expect(result.current).toHaveProperty('addMessage')
    expect(result.current).toHaveProperty('clearMessages')
    expect(result.current).toHaveProperty('setMessages')
    expect(Array.isArray(result.current.messages)).toBe(true)
  })
})

describe('useFeatures', () => {
  it('returns enabledFeatures, isEnabled, and toggleFeature', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper })
    expect(result.current).toHaveProperty('enabledFeatures')
    expect(result.current).toHaveProperty('isEnabled')
    expect(result.current).toHaveProperty('toggleFeature')
    expect(typeof result.current.isEnabled).toBe('function')
    expect(typeof result.current.toggleFeature).toBe('function')
  })
})
