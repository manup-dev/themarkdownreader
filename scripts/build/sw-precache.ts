// Build-time precache manifest for public/sw.js.
//
// The service worker can't know Vite's content-hashed chunk names, so this
// plugin computes them after the bundle is written and inlines a manifest
// into dist/sw.js. Each deploy gets its own cache version, which means the
// offline shell (index.html) and the chunks it references always come from
// the same build — the old "stale index.html points at deleted hashes"
// failure mode can't happen.
//
// What gets precached (downloaded in the background on first visit):
//   - the app shell: index.html, manifest.json, favicon/icons
//   - every chunk/CSS/asset statically reachable from the entry (required for
//     the app to boot at all)
//   - every other lazy chunk/CSS/font (reader views, folder/collection view,
//     mind map, mermaid diagrams, …) unless it is a source map, a .wasm
//     binary, an optional AI/TTS runtime, or bigger than `maxBytes`
//   - oversized lazy chunks of local (non-AI) features listed in
//     `alwaysPrecacheStems` — the excalidraw viewer, so a .excalidraw file
//     opens offline even if the viewer was never used online
// Everything else under assets/ is runtime-cached by the SW on first use.
//
// The plugin also fails the build if a chunk listed in `bootForbiddenStems`
// becomes part of the entry's static import graph (e.g. a vendor group
// hoisting React into the excalidraw chunk makes every first visit download
// it — see build.rolldownOptions.output.codeSplitting in vite.config.ts).

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export interface PrecacheBundleEntry {
  /** Output path relative to outDir, e.g. `assets/index-AbC123xY.js`. */
  fileName: string
  /** Emitted size in bytes. */
  size: number
  isEntry?: boolean
  /** Static imports (output file names) — chunks only. */
  imports?: string[]
  /** CSS/assets Vite attaches to a chunk (viteMetadata). */
  importedCss?: string[]
  importedAssets?: string[]
}

export interface PrecacheOptions {
  /** Lazy files larger than this are runtime-cached instead. */
  maxBytes?: number
  /** File stems (name without `-<hash>.<ext>`) never precached unless the
   *  entry statically needs them. Optional AI/TTS runtimes, multi-MB each. */
  excludeStems?: string[]
  /** File stems precached even when bigger than `maxBytes`: lazy chunks of
   *  local features that must work offline without having been used online. */
  alwaysPrecacheStems?: string[]
  /** File stems that must never be statically reachable from the entry;
   *  the build fails if one is. Defaults to the heavy lazy-feature vendor
   *  chunks plus `excludeStems`. */
  bootForbiddenStems?: string[]
}

export interface PrecacheManifest {
  /** Changes whenever any precached file (or the shell) changes. */
  version: string
  /** Scope-relative URLs to download at SW install. */
  precache: string[]
  /** Scope-relative asset URLs belonging to this build but left for runtime
   *  caching — lets the SW prune runtime-cache entries from older builds. */
  runtime: string[]
}

export const DEFAULT_MAX_PRECACHE_BYTES = 3_000_000
export const DEFAULT_EXCLUDE_STEMS = ['webllm', 'transformers', 'tts-worker', 'kokoro']
/** Excalidraw (~4 MB) is a local feature (.excalidraw files, diagrams), not an
 *  optional AI runtime: download it in the background at install so it works
 *  offline. Its hash only changes on a dependency bump, and the SW copies
 *  unchanged hashed files from the previous cache, so this is a one-off cost. */
export const DEFAULT_ALWAYS_PRECACHE_STEMS = ['excalidraw']
/** Heavy vendor chunks only lazy features need. */
export const DEFAULT_BOOT_FORBIDDEN_STEMS = ['excalidraw', 'mermaid', 'markmap']
/** Shell files copied from public/. Missing ones are skipped. */
export const SHELL_FILES = ['index.html', 'manifest.json', 'favicon.svg', 'icons.svg']

const NEVER_PRECACHE = /\.(map|wasm)$/i
// Only things the reading UI actually loads; keeps e.g. stray images/html out.
const PRECACHEABLE = /\.(m?js|css|woff2?|ttf|otf|svg|png|webp|json)$/i

/** `assets/kokoro-tts-CXQFuX0g.js` → `kokoro-tts`. */
export function fileStem(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName
  return base.replace(/-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/, '').replace(/\.[A-Za-z0-9]+$/, '')
}

/** Files the entry chunk(s) statically depend on — must be cached or the
 *  app cannot boot offline, regardless of size. */
export function staticClosure(entries: PrecacheBundleEntry[]): Set<string> {
  const byName = new Map(entries.map((e) => [e.fileName, e]))
  const out = new Set<string>()
  const stack = entries.filter((e) => e.isEntry).map((e) => e.fileName)
  while (stack.length) {
    const name = stack.pop()!
    if (out.has(name)) continue
    out.add(name)
    const e = byName.get(name)
    if (!e) continue
    for (const dep of [...(e.imports ?? []), ...(e.importedCss ?? []), ...(e.importedAssets ?? [])]) {
      if (!out.has(dep)) stack.push(dep)
    }
  }
  return out
}

/** Boot-path files (entry static closure) whose stem is forbidden there. */
export function bootPathViolations(entries: PrecacheBundleEntry[], forbiddenStems: string[]): string[] {
  const forbidden = new Set(forbiddenStems)
  return [...staticClosure(entries)].filter((f) => forbidden.has(fileStem(f))).sort()
}

export function selectPrecacheFiles(
  entries: PrecacheBundleEntry[],
  opts: PrecacheOptions = {},
): { precache: string[]; runtime: string[] } {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_PRECACHE_BYTES
  const excluded = new Set(opts.excludeStems ?? DEFAULT_EXCLUDE_STEMS)
  const always = new Set(opts.alwaysPrecacheStems ?? DEFAULT_ALWAYS_PRECACHE_STEMS)
  const required = staticClosure(entries)
  const precache: string[] = []
  const runtime: string[] = []
  for (const e of entries) {
    if (!e.fileName.startsWith('assets/')) continue // html/public files handled as shell
    if (/\.map$/i.test(e.fileName)) continue // never served to users
    const isRequired = required.has(e.fileName)
    const stem = fileStem(e.fileName)
    const optionalOk = PRECACHEABLE.test(e.fileName)
      && !NEVER_PRECACHE.test(e.fileName)
      && !excluded.has(stem)
      && (e.size <= maxBytes || always.has(stem))
    ;(isRequired || optionalOk ? precache : runtime).push(e.fileName)
  }
  precache.sort()
  runtime.sort()
  return { precache, runtime }
}

export function computeVersion(precache: string[], shellContents: Array<string | Uint8Array>): string {
  const h = createHash('sha256')
  for (const f of precache) h.update(f + '\n')
  for (const c of shellContents) h.update(c)
  return h.digest('hex').slice(0, 12)
}

/** Marker in public/sw.js that the plugin replaces with the manifest. */
export const MANIFEST_PLACEHOLDER = /\/\*\s*__MDR_PRECACHE_MANIFEST__\s*\*\/[^\n]*/

export function injectManifest(swSource: string, manifest: PrecacheManifest): string {
  if (!MANIFEST_PLACEHOLDER.test(swSource)) {
    throw new Error('sw.js is missing the /* __MDR_PRECACHE_MANIFEST__ */ placeholder')
  }
  return swSource.replace(MANIFEST_PLACEHOLDER, () => `${JSON.stringify(manifest)}`)
}

interface ViteMeta { importedCss?: Set<string>; importedAssets?: Set<string> }

/** Vite plugin: after the bundle is written, inline the precache manifest
 *  into `<outDir>/sw.js` (copied there from public/). */
export function swPrecachePlugin(opts: PrecacheOptions = {}): Plugin {
  let outDir = 'dist'
  return {
    name: 'md-reader-sw-precache',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      const swPath = path.join(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return // build without public/ (lib builds)
      const entries: PrecacheBundleEntry[] = Object.values(bundle).map((item) => {
        if (item.type === 'chunk') {
          const meta = (item as unknown as { viteMetadata?: ViteMeta }).viteMetadata
          return {
            fileName: item.fileName,
            size: Buffer.byteLength(item.code),
            isEntry: item.isEntry,
            imports: item.imports,
            importedCss: meta?.importedCss ? [...meta.importedCss] : [],
            importedAssets: meta?.importedAssets ? [...meta.importedAssets] : [],
          }
        }
        const src = item.source
        return { fileName: item.fileName, size: typeof src === 'string' ? Buffer.byteLength(src) : src.byteLength }
      })
      const violations = bootPathViolations(
        entries,
        opts.bootForbiddenStems ?? [...DEFAULT_BOOT_FORBIDDEN_STEMS, ...(opts.excludeStems ?? DEFAULT_EXCLUDE_STEMS)],
      )
      if (violations.length) {
        this.error(`lazy-feature chunks are statically imported by the entry (boot path): ${violations.join(', ')}. `
          + 'A codeSplitting group probably captured a shared dependency (e.g. React); see vite.config.ts.')
      }
      const { precache, runtime } = selectPrecacheFiles(entries, opts)
      const shell = SHELL_FILES.filter((f) => fs.existsSync(path.join(outDir, f)))
      const version = computeVersion(precache, shell.map((f) => fs.readFileSync(path.join(outDir, f))))
      const manifest: PrecacheManifest = { version, precache: [...shell, ...precache], runtime }
      fs.writeFileSync(swPath, injectManifest(fs.readFileSync(swPath, 'utf-8'), manifest))
      const sizeOf = (files: string[]) => files.reduce((n, f) => n + (entries.find((e) => e.fileName === f)?.size ?? 0), 0)
      this.info?.(`sw precache v${version}: ${manifest.precache.length} files (${(sizeOf(precache) / 1e6).toFixed(1)} MB assets), ${runtime.length} runtime-cached (${(sizeOf(runtime) / 1e6).toFixed(1)} MB)`)
    },
  }
}
