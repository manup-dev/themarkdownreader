import '@testing-library/jest-dom'

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
