import { describe, it, expect } from 'vitest'
import { bootPathViolations, DEFAULT_BOOT_FORBIDDEN_STEMS } from './boot-path-guard'
import type { PrecacheBundleEntry } from './sw-precache'

const MB = 1_000_000

describe('bootPathViolations', () => {
  it('is empty when forbidden chunks are only lazily reachable', () => {
    const lazy: PrecacheBundleEntry[] = [
      { fileName: 'assets/index-AAAAAAAA.js', size: 1, isEntry: true, imports: ['assets/react-vendor-BBBBBBBB.js'] },
      { fileName: 'assets/react-vendor-BBBBBBBB.js', size: 1, imports: [] },
      { fileName: 'assets/excalidraw-CCCCCCCC.js', size: 4.6 * MB, imports: ['assets/react-vendor-BBBBBBBB.js'] },
    ]
    expect(bootPathViolations(lazy, DEFAULT_BOOT_FORBIDDEN_STEMS)).toEqual([])
  })

  it('reports a forbidden chunk the entry reaches through static imports', () => {
    const hoisted: PrecacheBundleEntry[] = [
      { fileName: 'assets/index-AAAAAAAA.js', size: 1, isEntry: true, imports: ['assets/markdown-BBBBBBBB.js'] },
      // e.g. React hoisted into the excalidraw vendor chunk
      { fileName: 'assets/markdown-BBBBBBBB.js', size: 1, imports: ['assets/excalidraw-CCCCCCCC.js'], importedCss: [] },
      { fileName: 'assets/excalidraw-CCCCCCCC.js', size: 4.6 * MB, imports: ['assets/d3-EEEEEEEE.js'], importedCss: ['assets/excalidraw-FFFFFFFF.css'] },
      { fileName: 'assets/d3-EEEEEEEE.js', size: 1 },
      { fileName: 'assets/excalidraw-FFFFFFFF.css', size: 1 },
      { fileName: 'assets/mermaid-DDDDDDDD.js', size: 3 * MB, imports: ['assets/excalidraw-CCCCCCCC.js'] },
    ]
    expect(bootPathViolations(hoisted, DEFAULT_BOOT_FORBIDDEN_STEMS)).toEqual([
      'assets/d3-EEEEEEEE.js',
      'assets/excalidraw-CCCCCCCC.js',
      'assets/excalidraw-FFFFFFFF.css',
    ])
  })
})
