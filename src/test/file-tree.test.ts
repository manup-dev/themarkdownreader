import { describe, it, expect } from 'vitest'
import { buildFileTree, parentDir, ancestorDirs, childrenByDir, type FileTreeNode } from '../lib/file-tree'

/**
 * Pins the flat-paths → nested-tree transform that powers the sidebar
 * file explorer. The core bug it fixes: same-named files across folders
 * (and a file vs. a folder of the same name) used to render as
 * indistinguishable bare basenames.
 */
const f = (path: string, lastModified = 0) => ({ path, name: path.split('/').pop()!, lastModified })

const names = (nodes: FileTreeNode[]) => nodes.map(n => `${n.type === 'folder' ? '📁' : '📄'}${n.name}`)

describe('buildFileTree', () => {
  it('nests files under folder nodes derived from path segments', () => {
    const tree = buildFileTree([f('docs/api.md'), f('docs/intro.md'), f('README.md')], 'name-asc')
    expect(names(tree)).toEqual(['📁docs', '📄README.md'])
    const docs = tree[0] as Extract<FileTreeNode, { type: 'folder' }>
    expect(docs.path).toBe('docs')
    expect(names(docs.children)).toEqual(['📄api.md', '📄intro.md'])
  })

  it('orders folders before files within a level', () => {
    const tree = buildFileTree([f('zeta.md'), f('alpha/one.md'), f('beta.md')], 'name-asc')
    expect(names(tree)).toEqual(['📁alpha', '📄beta.md', '📄zeta.md'])
  })

  it('disambiguates a file and a folder of the same name', () => {
    const tree = buildFileTree([f('guide.md'), f('guide/index.md')], 'name-asc')
    // Two distinct nodes: folder `guide` (with a chevron/children) + file `guide.md`.
    expect(names(tree)).toEqual(['📁guide', '📄guide.md'])
    const folder = tree[0] as Extract<FileTreeNode, { type: 'folder' }>
    expect(folder.type).toBe('folder')
    expect(names(folder.children)).toEqual(['📄index.md'])
  })

  it('keeps same-named files in separate folder branches', () => {
    const tree = buildFileTree([f('docs/intro.md'), f('examples/intro.md')], 'name-asc')
    expect(names(tree)).toEqual(['📁docs', '📁examples'])
    const docs = tree[0] as Extract<FileTreeNode, { type: 'folder' }>
    const examples = tree[1] as Extract<FileTreeNode, { type: 'folder' }>
    expect(docs.children[0].path).toBe('docs/intro.md')
    expect(examples.children[0].path).toBe('examples/intro.md')
  })

  it('applies name-desc to both folders and files', () => {
    const tree = buildFileTree([f('a.md'), f('b.md'), f('x/one.md'), f('y/two.md')], 'name-desc')
    expect(names(tree)).toEqual(['📁y', '📁x', '📄b.md', '📄a.md'])
  })

  it('applies mtime ordering to files (folders stay name-ordered)', () => {
    const tree = buildFileTree([f('a.md', 100), f('b.md', 300), f('c.md', 200)], 'mtime-desc')
    expect(names(tree)).toEqual(['📄b.md', '📄c.md', '📄a.md'])
  })

  it('honors manual order for custom mode, name-asc fallback for unlisted', () => {
    const manual = { '': ['b.md', 'a.md'] } // c.md not listed → falls to end by name
    const tree = buildFileTree([f('a.md'), f('b.md'), f('c.md')], 'custom', manual)
    expect(names(tree)).toEqual(['📄b.md', '📄a.md', '📄c.md'])
  })

  it('is deterministic regardless of input order', () => {
    const input = [f('m/z.md'), f('a.md'), f('m/a.md'), f('b/c.md')]
    const t1 = names(buildFileTree(input, 'name-asc'))
    const t2 = names(buildFileTree(input.slice().reverse(), 'name-asc'))
    expect(t1).toEqual(t2)
  })
})

describe('parentDir / ancestorDirs', () => {
  it('parentDir returns the containing dir or empty for root', () => {
    expect(parentDir('a/b/c.md')).toBe('a/b')
    expect(parentDir('root.md')).toBe('')
  })

  it('ancestorDirs returns each prefix outermost-first', () => {
    expect(ancestorDirs('a/b/c.md')).toEqual(['a', 'a/b'])
    expect(ancestorDirs('root.md')).toEqual([])
  })
})

describe('childrenByDir', () => {
  it('maps every dir to its child nodes', () => {
    const tree = buildFileTree([f('docs/api.md'), f('README.md')], 'name-asc')
    const map = childrenByDir(tree)
    expect(names(map.get('')!)).toEqual(['📁docs', '📄README.md'])
    expect(names(map.get('docs')!)).toEqual(['📄api.md'])
  })
})
