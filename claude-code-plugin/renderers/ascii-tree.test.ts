import { describe, it, expect } from 'vitest'
import { renderAsciiTree } from './ascii-tree.js'
import type { TreeNode } from '../../shared/tree-parser.js'

const sampleTree: TreeNode = {
  id: 'root', name: 'Document', value: 0,
  children: [
    { id: 'intro', name: 'Introduction', value: 50, children: [
      { id: 'bg', name: 'Background', value: 30, children: [] },
      { id: 'motiv', name: 'Motivation', value: 20, children: [] },
    ]},
    { id: 'arch', name: 'Architecture', value: 100, children: [
      { id: 'fe', name: 'Frontend', value: 60, children: [
        { id: 'react', name: 'React Components', value: 40, children: [] },
        { id: 'state', name: 'State Management', value: 20, children: [] },
      ]},
      { id: 'be', name: 'Backend', value: 40, children: [] },
    ]},
    { id: 'conc', name: 'Conclusion', value: 30, children: [] },
  ],
}

describe('renderAsciiTree', () => {
  it('renders root name as first line', () => {
    const output = renderAsciiTree(sampleTree, { color: false })
    const lines = output.split('\n')
    expect(lines[0]).toBe('Document')
  })

  it('contains box-drawing characters', () => {
    const output = renderAsciiTree(sampleTree, { color: false })
    expect(output).toContain('├─')
    expect(output).toContain('└─')
    expect(output).toContain('│')
  })

  it('contains all node names', () => {
    const output = renderAsciiTree(sampleTree, { color: false })
    expect(output).toContain('Introduction')
    expect(output).toContain('Background')
    expect(output).toContain('Motivation')
    expect(output).toContain('Architecture')
    expect(output).toContain('Frontend')
    expect(output).toContain('React Components')
    expect(output).toContain('State Management')
    expect(output).toContain('Backend')
    expect(output).toContain('Conclusion')
  })

  it('maxDepth truncates deep nodes with +N indicator', () => {
    // maxDepth=2 means: root (depth 0), children (depth 1), grandchildren (depth 2)
    // depth-3 nodes (React Components, State Management) should be hidden
    const output = renderAsciiTree(sampleTree, { color: false, maxDepth: 2 })
    // Depth-3 nodes should NOT appear as normal entries
    expect(output).not.toContain('React Components\n')
    expect(output).not.toContain('State Management\n')
    // Frontend has 2 descendants, should show truncation indicator
    expect(output).toContain('+2')
    // Backend has 0 children so no truncation needed — still present
    expect(output).toContain('Backend')
  })

  it('renders a single-node tree as just the name', () => {
    const singleNode: TreeNode = { id: 'only', name: 'OnlyNode', value: 1, children: [] }
    const output = renderAsciiTree(singleNode, { color: false })
    expect(output.trim()).toBe('OnlyNode')
  })

  it('produces ANSI escape sequences when color=true', () => {
    const output = renderAsciiTree(sampleTree, { color: true })
    // ANSI reset or bold code must be present
    expect(output).toContain('\x1b[')
  })

  it('produces correct tree structure matching expected output', () => {
    const output = renderAsciiTree(sampleTree, { color: false })
    const expected = [
      'Document',
      '├─ Introduction',
      '│  ├─ Background',
      '│  └─ Motivation',
      '├─ Architecture',
      '│  ├─ Frontend',
      '│  │  ├─ React Components',
      '│  │  └─ State Management',
      '│  └─ Backend',
      '└─ Conclusion',
    ].join('\n')
    expect(output).toBe(expected)
  })
})
