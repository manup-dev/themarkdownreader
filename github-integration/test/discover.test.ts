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

  it('follows symlinked directories without revisiting them', async () => {
    const { symlink } = await import('node:fs/promises')
    // Set up: real dir `a` with a sidecar; symlink `b` pointing to `a`.
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'page.md'), '# page')
    await writeFile(join(root, 'a', '.page.md.annot'), '')
    await symlink(join(root, 'a'), join(root, 'b'), 'dir')
    const pairs = await findSidecars(root)
    // The same real file is reachable via both paths (a/ and b/);
    // cycle guard ensures we visit it once, not twice.
    const stems = pairs.map((p) => p.sourcePath.replace(root + '/', '')).sort()
    // root contains: foo.md, sub/bar.md (from beforeAll), and a/page.md (new).
    // b/ is a symlink to a/ — cycle guard should prevent revisiting a/page.md via b/.
    expect(stems).toEqual(['a/page.md', 'foo.md', 'sub/bar.md'])
  })

  it('breaks cycles when a symlink points back to the root', async () => {
    const { symlink } = await import('node:fs/promises')
    // Use a fresh isolated tmp dir so no sidecars from beforeAll/prior tests bleed in.
    const isolated = await mkdtemp(join(tmpdir(), 'mdr-selflink-'))
    try {
      // Root contains a sidecar pair plus a symlink that points back to root.
      await writeFile(join(isolated, 'doc.md'), '# d')
      await writeFile(join(isolated, '.doc.md.annot'), '')
      await symlink(isolated, join(isolated, 'self'), 'dir')
      const pairs = await findSidecars(isolated)
      // Without seeding root's inode, the symlink walks root again and emits a duplicate.
      const sidecars = pairs.map((p) => p.sidecarPath.replace(isolated + '/', '')).sort()
      expect(sidecars).toEqual(['.doc.md.annot'])
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})
