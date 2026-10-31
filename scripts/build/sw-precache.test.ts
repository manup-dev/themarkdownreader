import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  fileStem,
  staticClosure,
  selectPrecacheFiles,
  bootPathViolations,
  computeVersion,
  injectManifest,
  type PrecacheBundleEntry,
} from './sw-precache'

const MB = 1_000_000

const bundle: PrecacheBundleEntry[] = [
  { fileName: 'index.html', size: 3000 },
  { fileName: 'assets/index-AAAAAAAA.js', size: 480_000, isEntry: true, imports: ['assets/vendor-BBBBBBBB.js'], importedCss: ['assets/index-CCCCCCCC.css'] },
  // Huge but statically imported by the entry → must be precached anyway.
  { fileName: 'assets/vendor-BBBBBBBB.js', size: 4.7 * MB, imports: [] },
  { fileName: 'assets/index-CCCCCCCC.css', size: 160_000 },
  { fileName: 'assets/index-AAAAAAAA.js.map', size: 9 * MB },
  { fileName: 'assets/CollectionView-DDDDDDDD.js', size: 6_000 },
  { fileName: 'assets/mermaid-EEEEEEEE.js', size: 2.4 * MB },
  { fileName: 'assets/KaTeX_Main-Regular-FFFFFFFF.woff2', size: 26_000 },
  { fileName: 'assets/webllm-GGGGGGGG.js', size: 6 * MB },
  { fileName: 'assets/transformers-HHHHHHHH.js', size: 1.4 * MB },
  { fileName: 'assets/kokoro-IIIIIIII.js', size: 1.3 * MB },
  { fileName: 'assets/kokoro-tts-JJJJJJJJ.js', size: 5_600 },
  { fileName: 'assets/tts-worker-KKKKKKKK.js', size: 2.2 * MB },
  { fileName: 'assets/ort-wasm-simd-threaded.jsep-LLLLLLLL.wasm', size: 21 * MB },
  { fileName: 'assets/big-lazy-view-MMMMMMMM.js', size: 4 * MB },
  // Lazy, oversized, but a local feature → precached via alwaysPrecacheStems.
  { fileName: 'assets/excalidraw-NNNNNNNN.js', size: 4.6 * MB },
  // Self-hosted excalidraw fonts: latin ones precached, CJK subsets on demand.
  { fileName: 'assets/excalidraw-0a1b2c3d/fonts/Virgil/Virgil-Regular.woff2', size: 56_000 },
  { fileName: 'assets/excalidraw-0a1b2c3d/fonts/Xiaolai/Xiaolai-Regular-09850c4077f3fffe707905872e0e2460.woff2', size: 60_000 },
]

describe('fileStem', () => {
  it('strips the 8-char content hash and extension', () => {
    expect(fileStem('assets/kokoro-tts-CXQFuX0g.js')).toBe('kokoro-tts')
    expect(fileStem('assets/kokoro-DUB3-M-i.js')).toBe('kokoro')
    expect(fileStem('assets/tts-worker-CqNJfHjC.js')).toBe('tts-worker')
    expect(fileStem('assets/KaTeX_AMS-Regular-DRggAlZN.ttf')).toBe('KaTeX_AMS-Regular')
    expect(fileStem('favicon.svg')).toBe('favicon')
  })
})

describe('staticClosure', () => {
  it('follows static imports and attached CSS from the entry', () => {
    const closure = staticClosure(bundle)
    expect([...closure].sort()).toEqual([
      'assets/index-AAAAAAAA.js',
      'assets/index-CCCCCCCC.css',
      'assets/vendor-BBBBBBBB.js',
    ])
  })

  it('tolerates import cycles', () => {
    const cyclic: PrecacheBundleEntry[] = [
      { fileName: 'assets/a-AAAAAAAA.js', size: 1, isEntry: true, imports: ['assets/b-BBBBBBBB.js'] },
      { fileName: 'assets/b-BBBBBBBB.js', size: 1, imports: ['assets/a-AAAAAAAA.js'] },
    ]
    expect(staticClosure(cyclic).size).toBe(2)
  })
})

describe('selectPrecacheFiles', () => {
  const { precache, runtime } = selectPrecacheFiles(bundle)

  it('precaches the entry graph regardless of size', () => {
    expect(precache).toContain('assets/index-AAAAAAAA.js')
    expect(precache).toContain('assets/vendor-BBBBBBBB.js')
    expect(precache).toContain('assets/index-CCCCCCCC.css')
  })

  it('precaches lazy reading chunks, fonts and mermaid', () => {
    expect(precache).toContain('assets/CollectionView-DDDDDDDD.js')
    expect(precache).toContain('assets/KaTeX_Main-Regular-FFFFFFFF.woff2')
    expect(precache).toContain('assets/mermaid-EEEEEEEE.js')
    expect(precache).toContain('assets/kokoro-tts-JJJJJJJJ.js') // tiny wrapper, not the runtime
  })

  it('leaves AI runtimes, wasm and oversized lazy chunks to runtime caching', () => {
    for (const f of [
      'assets/webllm-GGGGGGGG.js',
      'assets/transformers-HHHHHHHH.js',
      'assets/kokoro-IIIIIIII.js',
      'assets/tts-worker-KKKKKKKK.js',
      'assets/ort-wasm-simd-threaded.jsep-LLLLLLLL.wasm',
      'assets/big-lazy-view-MMMMMMMM.js',
    ]) {
      expect(precache).not.toContain(f)
      expect(runtime).toContain(f)
    }
  })

  it('precaches oversized local-feature chunks listed in alwaysPrecacheStems', () => {
    expect(precache).toContain('assets/excalidraw-NNNNNNNN.js') // default list
    const none = selectPrecacheFiles(bundle, { alwaysPrecacheStems: [] })
    expect(none.precache).not.toContain('assets/excalidraw-NNNNNNNN.js')
    expect(none.runtime).toContain('assets/excalidraw-NNNNNNNN.js')
    // Exact stem match only — a different oversized chunk is not swept in.
    expect(precache).not.toContain('assets/big-lazy-view-MMMMMMMM.js')
  })

  it('precaches latin excalidraw fonts but runtime-caches the CJK Xiaolai subsets', () => {
    expect(precache).toContain('assets/excalidraw-0a1b2c3d/fonts/Virgil/Virgil-Regular.woff2')
    const cjk = 'assets/excalidraw-0a1b2c3d/fonts/Xiaolai/Xiaolai-Regular-09850c4077f3fffe707905872e0e2460.woff2'
    expect(precache).not.toContain(cjk)
    expect(runtime).toContain(cjk)
  })

  it('never lists source maps or non-asset files', () => {
    expect([...precache, ...runtime].some((f) => f.endsWith('.map'))).toBe(false)
    expect([...precache, ...runtime]).not.toContain('index.html')
  })

  it('honours a custom size cap', () => {
    const small = selectPrecacheFiles(bundle, { maxBytes: 1 * MB })
    expect(small.precache).not.toContain('assets/mermaid-EEEEEEEE.js')
    expect(small.precache).toContain('assets/vendor-BBBBBBBB.js') // still required
  })
})

describe('bootPathViolations', () => {
  it('is empty when forbidden chunks are only lazily reachable', () => {
    expect(bootPathViolations(bundle, ['excalidraw', 'mermaid', 'webllm'])).toEqual([])
  })

  it('reports a forbidden chunk the entry statically imports', () => {
    const hoisted: PrecacheBundleEntry[] = [
      { fileName: 'assets/index-AAAAAAAA.js', size: 1, isEntry: true, imports: ['assets/markdown-BBBBBBBB.js'] },
      // e.g. React hoisted into the excalidraw vendor chunk
      { fileName: 'assets/markdown-BBBBBBBB.js', size: 1, imports: ['assets/excalidraw-CCCCCCCC.js'] },
      { fileName: 'assets/excalidraw-CCCCCCCC.js', size: 4.6 * MB, imports: [] },
      { fileName: 'assets/mermaid-DDDDDDDD.js', size: 3 * MB, imports: ['assets/excalidraw-CCCCCCCC.js'] },
    ]
    expect(bootPathViolations(hoisted, ['excalidraw', 'mermaid'])).toEqual(['assets/excalidraw-CCCCCCCC.js'])
  })
})

describe('computeVersion', () => {
  it('is stable for identical input and changes when the shell changes', () => {
    const a = computeVersion(['assets/x-AAAAAAAA.js'], ['<html>1'])
    expect(computeVersion(['assets/x-AAAAAAAA.js'], ['<html>1'])).toBe(a)
    expect(computeVersion(['assets/x-AAAAAAAA.js'], ['<html>2'])).not.toBe(a)
    expect(computeVersion(['assets/x-BBBBBBBB.js'], ['<html>1'])).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('injectManifest', () => {
  it('replaces the placeholder in the real public/sw.js', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf-8')
    const manifest = { version: 'abc123def456', precache: ['index.html', 'assets/a-AAAAAAAA.js'], runtime: ['assets/b-BBBBBBBB.js'] }
    const out = injectManifest(src, manifest)
    expect(out).not.toContain('__MDR_PRECACHE_MANIFEST__')
    expect(out).toContain(`const MANIFEST = ${JSON.stringify(manifest)}`)
    // Still valid JS.
    expect(() => new Function(out)).not.toThrow()
  })

  it('throws when the placeholder is missing', () => {
    expect(() => injectManifest('const x = 1', { version: 'v', precache: [], runtime: [] })).toThrow(/placeholder/)
  })
})
