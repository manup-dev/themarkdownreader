import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSidecars } from '../src/discover'

describe('findSidecars', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mdr-discover-'))
    await writeFile(join(root, 'foo.md'), '# foo')
    await writeFile(join(root, '.foo.md.annot'), '')
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'sub', 'bar.md'), '# bar')
    await writeFile(join(root, 'sub', '.bar.md.annot'), '')
    // Orphans:
    await writeFile(join(root, 'lonely.md'), '# no sidecar')
    await writeFile(join(root, '.orphan.md.annot'), '')
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'README.md'), '# skip me')
    await writeFile(join(root, 'node_modules', 'pkg', '.README.md.annot'), '')
  })

  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('pairs each .{stem}.annot with its source .md', async () => {
    const pairs = await findSidecars(root)
    const rels = pairs.map((p) => ({
      source: p.sourcePath.replace(root + '/', ''),
      sidecar: p.sidecarPath.replace(root + '/', ''),
    })).sort((a, b) => a.source.localeCompare(b.source))

    expect(rels).toEqual([
      { source: 'foo.md', sidecar: '.foo.md.annot' },
      { source: 'sub/bar.md', sidecar: 'sub/.bar.md.annot' },
    ])
  })

  it('skips orphan sidecars (sidecar without source)', async () => {
    const pairs = await findSidecars(root)
    expect(pairs.find((p) => p.sidecarPath.endsWith('.orphan.md.annot'))).toBeUndefined()
  })

  it('skips node_modules', async () => {
    const pairs = await findSidecars(root)
    expect(pairs.find((p) => p.sourcePath.includes('node_modules'))).toBeUndefined()
  })
})
