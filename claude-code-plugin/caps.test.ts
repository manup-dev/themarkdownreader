import { describe, it, expect, beforeEach } from 'vitest'
import { detectTerminalCaps, getCachedCaps, resetCapsCache } from './caps.js'

const CLEAN_VARS = ['MD_READER_TERM_CAPS', 'COLORTERM', 'TERM_PROGRAM', 'TERM']

beforeEach(() => {
  for (const key of CLEAN_VARS) {
    delete process.env[key]
  }
  resetCapsCache()
})

describe('detectTerminalCaps', () => {
  it('returns all-false/none for dumb terminal', () => {
    process.env.TERM = 'dumb'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('none')
    expect(caps.truecolor).toBe(false)
    expect(caps.color256).toBe(false)
    expect(caps.unicode).toBe(false)
    expect(caps.mouse).toBe(false)
    expect(caps.hyperlinks).toBe(false)
  })

  it('detects truecolor from COLORTERM=truecolor', () => {
    process.env.COLORTERM = 'truecolor'
    process.env.TERM = 'xterm'
    const caps = detectTerminalCaps()
    expect(caps.truecolor).toBe(true)
    expect(caps.color256).toBe(true)
  })

  it('detects truecolor from COLORTERM=24bit', () => {
    process.env.COLORTERM = '24bit'
    process.env.TERM = 'xterm'
    const caps = detectTerminalCaps()
    expect(caps.truecolor).toBe(true)
    expect(caps.color256).toBe(true)
  })

  it('detects Kitty image protocol from TERM=xterm-kitty', () => {
    process.env.TERM = 'xterm-kitty'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('kitty')
    expect(caps.hyperlinks).toBe(true)
    expect(caps.mouse).toBe(true)
  })

  it('detects Kitty image protocol from TERM_PROGRAM=kitty', () => {
    process.env.TERM_PROGRAM = 'kitty'
    process.env.TERM = 'xterm-256color'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('kitty')
  })

  it('detects iTerm2 iterm protocol from TERM_PROGRAM=iTerm.app', () => {
    process.env.TERM_PROGRAM = 'iTerm.app'
    process.env.TERM = 'xterm-256color'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('iterm')
    expect(caps.hyperlinks).toBe(true)
  })

  it('detects WezTerm as iterm protocol', () => {
    process.env.TERM_PROGRAM = 'WezTerm'
    process.env.TERM = 'xterm-256color'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('iterm')
    expect(caps.hyperlinks).toBe(true)
  })

  it('detects hyperlinks for known terminals in allowlist', () => {
    const allowlisted = ['iTerm.app', 'WezTerm', 'vscode', 'Hyper', 'Tabby', 'Alacritty', 'Ghostty']
    for (const terminal of allowlisted) {
      delete process.env.TERM
      process.env.TERM_PROGRAM = terminal
      resetCapsCache()
      const caps = detectTerminalCaps()
      expect(caps.hyperlinks, `${terminal} should support hyperlinks`).toBe(true)
    }
  })

  it('respects MD_READER_TERM_CAPS override', () => {
    process.env.MD_READER_TERM_CAPS = 'kitty,truecolor,unicode,mouse,hyperlinks'
    process.env.TERM = 'dumb' // would normally disable everything
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('kitty')
    expect(caps.truecolor).toBe(true)
    expect(caps.unicode).toBe(true)
    expect(caps.mouse).toBe(true)
    expect(caps.hyperlinks).toBe(true)
  })

  it('MD_READER_TERM_CAPS override with sixel sets sixel protocol', () => {
    process.env.MD_READER_TERM_CAPS = 'sixel,color256'
    const caps = detectTerminalCaps()
    expect(caps.imageProtocol).toBe('sixel')
    expect(caps.color256).toBe(true)
    expect(caps.truecolor).toBe(false)
  })

  it('unicode is true by default for non-dumb terminal', () => {
    process.env.TERM = 'xterm-256color'
    const caps = detectTerminalCaps()
    expect(caps.unicode).toBe(true)
  })
})

describe('getCachedCaps', () => {
  it('returns the same object on repeated calls', () => {
    process.env.TERM = 'xterm-256color'
    const first = getCachedCaps()
    const second = getCachedCaps()
    expect(first).toBe(second)
  })

  it('cache is cleared by resetCapsCache', () => {
    process.env.TERM = 'xterm-256color'
    const first = getCachedCaps()
    resetCapsCache()
    process.env.TERM = 'dumb'
    const second = getCachedCaps()
    expect(first).not.toBe(second)
    expect(second.unicode).toBe(false)
  })
})
