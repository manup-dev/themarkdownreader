import '@testing-library/jest-dom'
// Provide an IndexedDB implementation for jsdom. The app assumes IndexedDB
// exists (it's a browser app using Dexie), so components rendered in tests
// may fire-and-forget persistence writes. Without this, such a floating
// write rejects with MissingAPIError and the unhandled rejection fails the
// whole `vitest run` even when every test passes. Individual tests that
// exercise Dexie directly still import 'fake-indexeddb/auto' too (no-op here).
import 'fake-indexeddb/auto'

// jsdom does not implement window.matchMedia — stub it so modules that
// read prefers-color-scheme at import time (e.g. useStore) can load.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
}
