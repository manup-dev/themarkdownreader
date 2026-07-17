import { describe, it, expect, vi, afterEach } from 'vitest'
import { IFrameBridge } from '../lib/iframe-bridge'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('IFrameBridge.start (A7 — aborted bridge must not listen)', () => {
  it('registers NO window message listener when the parent origin cannot be pinned', () => {
    // Force the "no origin" abort path: a referrer that is not a valid URL
    // makes `new URL(document.referrer)` throw → parentOrigin = ''. This is
    // the sandboxed-iframe shape (origin 'null', no usable referrer).
    Object.defineProperty(document, 'referrer', { value: 'null', configurable: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const addSpy = vi.spyOn(window, 'addEventListener')

    new IFrameBridge().start()

    expect(warn).toHaveBeenCalledWith('[md-reader/iframe] no parent origin; aborting bridge')
    const registeredTypes = addSpy.mock.calls.map(([type]) => type)
    // With the bug, 'message' (and 'pagehide') are registered BEFORE the
    // abort check — any window could then post a HELLO envelope + port and
    // take over the "aborted" bridge (onWindowMessage skips the origin
    // check entirely when parentOrigin === '').
    expect(registeredTypes).not.toContain('message')
  })
})
