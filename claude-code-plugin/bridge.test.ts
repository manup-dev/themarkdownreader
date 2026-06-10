import { describe, it, expect, beforeEach } from 'vitest'
import { renderMindMapResult } from './bridge.js'
import { resetCapsCache } from './caps.js'

const sampleResult = JSON.stringify({
  type: 'mind_map',
  tree: {
    id: 'root', name: 'Document', value: 0,
    children: [
      { id: 'intro', name: 'Introduction', value: 50, children: [] },
      { id: 'arch', name: 'Architecture', value: 100, children: [
        { id: 'fe', name: 'Frontend', value: 60, children: [] },
        { id: 'be', name: 'Backend', value: 40, children: [] },
      ]},
    ],
  },
  source_file: '/tmp/test.md',
  browser_url: 'http://localhost:5183/#file=test.md&view=mindmap',
  total_nodes: 5,
  max_depth: 2,
  section: null,
})

beforeEach(() => {
  resetCapsCache()
  delete process.env.MD_READER_TERM_CAPS
  process.env.TERM = 'xterm-256color'
  process.env.COLORTERM = 'truecolor'
})

describe('renderMindMapResult', () => {
  it('renders ASCII tree for non-image terminals', async () => {
    process.env.MD_READER_TERM_CAPS = 'truecolor'
    resetCapsCache()
    const output = await renderMindMapResult(sampleResult)
    expect(output).toContain('Mind Map')
    expect(output).toContain('Introduction')
    expect(output).toContain('Architecture')
    expect(output).toContain('Frontend')
    expect(output).toContain('├─')
    expect(output).toContain('browser')
  })

  it('passes through non-JSON text unchanged', async () => {
    const text = 'This is not JSON at all'
    const output = await renderMindMapResult(text)
    expect(output).toBe(text)
  })

  it('passes through non-mind-map JSON unchanged', async () => {
    const json = JSON.stringify({ type: 'summary', content: 'Some summary text' })
    const output = await renderMindMapResult(json)
    expect(output).toBe(json)
  })

  it('includes node count and depth in header', async () => {
    process.env.MD_READER_TERM_CAPS = 'truecolor'
    resetCapsCache()
    const output = await renderMindMapResult(sampleResult)
    expect(output).toContain('5 nodes')
    expect(output).toContain('2 levels deep')
  })

  it('includes OSC 8 hyperlink when caps have hyperlinks', async () => {
    process.env.MD_READER_TERM_CAPS = 'hyperlinks'
    resetCapsCache()
    const output = await renderMindMapResult(sampleResult)
    expect(output).toContain('\x1b]8;;http://localhost:5183')
  })
})
