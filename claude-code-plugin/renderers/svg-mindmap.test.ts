import { describe, it, expect } from 'vitest'
import { generateMindMapSvg } from './svg-mindmap.js'

const sampleMarkdown = `# My Document\n\n## Section One\n\nContent here.\n\n## Section Two\n\n### Nested Section\n\nMore content.\n`

describe('generateMindMapSvg', () => {
  it('returns valid SVG (contains <svg and </svg>)', () => {
    const result = generateMindMapSvg(sampleMarkdown)
    expect(result).toContain('<svg')
    expect(result).toContain('</svg>')
  })

  it('includes heading text in SVG', () => {
    const result = generateMindMapSvg(sampleMarkdown)
    expect(result).toContain('Section One')
    expect(result).toContain('Section Two')
    expect(result).toContain('Nested Section')
  })

  it('handles empty markdown without crashing', () => {
    expect(() => generateMindMapSvg('')).not.toThrow()
    const result = generateMindMapSvg('')
    expect(result).toContain('<svg')
    expect(result).toContain('</svg>')
  })

  it('respects width/height options', () => {
    const result = generateMindMapSvg(sampleMarkdown, { width: 800, height: 400 })
    expect(result).toContain('width="800"')
    expect(result).toContain('height="400"')
  })
})
