import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { excalidrawProdDir, listFontFiles, fontSetHash } from './excalidraw-assets'

const root = path.resolve(__dirname, '../..')
const prodDir = excalidrawProdDir(root)

describe('excalidraw font self-hosting', () => {
  const all = listFontFiles(prodDir)

  it('covers every font URL the installed excalidraw build references', () => {
    // excalidraw resolves `./fonts/<Family>/<file>` against EXCALIDRAW_ASSET_PATH;
    // if a release moves or renames them, self-hosting silently falls back to esm.sh.
    const rels = new Set(all.map((f) => f.rel))
    const referenced = new Set<string>()
    for (const f of fs.readdirSync(prodDir).filter((n) => n.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(prodDir, f), 'utf-8').matchAll(/"\.\/(fonts\/[^"]+\.woff2)"/g)) referenced.add(m[1])
    }
    expect(referenced.size).toBeGreaterThan(10)
    expect([...referenced].filter((r) => !rels.has(r))).toEqual([])
    expect(rels.has('fonts/Virgil/Virgil-Regular.woff2')).toBe(true)
  })

  it('skips requested families', () => {
    const lean = listFontFiles(prodDir, ['Xiaolai'])
    expect(lean.some((f) => f.rel.startsWith('fonts/Xiaolai/'))).toBe(false)
    expect(lean.some((f) => f.rel.startsWith('fonts/Excalifont/'))).toBe(true)
    expect(lean.length).toBeLessThan(all.length)
  })

  it('hashes the font set deterministically', () => {
    const lean = listFontFiles(prodDir, ['Xiaolai'])
    expect(fontSetHash(lean)).toMatch(/^[0-9a-f]{8}$/)
    expect(fontSetHash(lean)).toBe(fontSetHash(listFontFiles(prodDir, ['Xiaolai'])))
    expect(fontSetHash(lean.slice(1))).not.toBe(fontSetHash(lean))
  })
})
