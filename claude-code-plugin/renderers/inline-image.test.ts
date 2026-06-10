import { describe, it, expect } from 'vitest'
import { encodeInlineImage } from './inline-image.js'

// 1x1 red PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)

describe('encodeInlineImage', () => {
  it("protocol 'none' returns empty string", () => {
    expect(encodeInlineImage(TINY_PNG, 'none')).toBe('')
  })

  it("iterm output contains \\x1b]1337;File= and inline=1 and BEL", () => {
    const result = encodeInlineImage(TINY_PNG, 'iterm')
    expect(result).toContain('\x1b]1337;File=')
    expect(result).toContain('inline=1')
    expect(result).toContain('\x07')
  })

  it("kitty output contains \\x1b_G and \\x1b\\\\", () => {
    const result = encodeInlineImage(TINY_PNG, 'kitty')
    expect(result).toContain('\x1b_G')
    expect(result).toContain('\x1b\\')
  })

  it("sixel returns placeholder message", () => {
    const result = encodeInlineImage(TINY_PNG, 'sixel')
    expect(result).toContain('[Sixel rendering not yet implemented')
  })

  it("iterm output contains base64 of the PNG", () => {
    const result = encodeInlineImage(TINY_PNG, 'iterm')
    const base64 = TINY_PNG.toString('base64')
    expect(result).toContain(base64)
  })
})
