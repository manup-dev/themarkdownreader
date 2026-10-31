// Self-hosts @excalidraw/excalidraw's fonts.
//
// Excalidraw loads its scene fonts (Excalifont, Virgil, Nunito, Xiaolai, …)
// from JS via FontFace, not from index.css. Each font's URL is built as
//   new URL('fonts/<Family>/<file>.woff2', normalize(window.EXCALIDRAW_ASSET_PATH))
// with `https://esm.sh/@excalidraw/excalidraw@<ver>/dist/prod/` appended as a
// fallback (see `createUrls`/`normalizeBaseUrl` in dist/prod/chunk-*.js).
// `normalizeBaseUrl` appends a trailing slash and resolves "/x" or "./x"
// against the *origin* (not the page), so the app passes an absolute URL.
//
// Without EXCALIDRAW_ASSET_PATH every font is a third-party request to esm.sh,
// which also fails offline. This plugin copies `dist/prod/fonts/**` into the
// build under `assets/excalidraw-<contenthash>/fonts/…` (the layout excalidraw
// expects below the asset path) and exposes that directory to the app as
// `__MDR_EXCALIDRAW_ASSETS__`. The directory is content-hashed because most
// font file names are not, and the service worker treats everything under
// assets/ as immutable. Nothing here is on the boot path: fonts are only
// requested once the lazy excalidraw viewer renders text.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

export interface ExcalidrawAssetsOptions {
  /** Font family directories to leave out (they fall back to esm.sh). */
  skipFamilies?: string[]
}

export interface FontFile {
  /** Path below the excalidraw asset root, e.g. `fonts/Virgil/Virgil-Regular.woff2`. */
  rel: string
  abs: string
}

/** `<pkg>/dist/prod` — the directory excalidraw's relative font URLs are based on. */
export function excalidrawProdDir(root: string): string {
  // The package's exports map has no ./package.json; "." resolves (via the
  // `default` condition) to dist/prod/index.js, next to dist/prod/fonts/.
  const req = createRequire(path.join(root, 'package.json'))
  return path.dirname(req.resolve('@excalidraw/excalidraw'))
}

export function listFontFiles(prodDir: string, skipFamilies: string[] = []): FontFile[] {
  const skip = new Set(skipFamilies)
  const out: FontFile[] = []
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(abs)
      else if (/\.(woff2?|ttf|otf)$/i.test(ent.name)) out.push({ rel: path.relative(prodDir, abs).split(path.sep).join('/'), abs })
    }
  }
  const fontsDir = path.join(prodDir, 'fonts')
  for (const fam of fs.readdirSync(fontsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (fam.isDirectory() && !skip.has(fam.name)) walk(path.join(fontsDir, fam.name))
  }
  return out
}

/** 8-char hash of the font set (paths + bytes). */
export function fontSetHash(files: FontFile[]): string {
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f.rel + '\n')
    h.update(fs.readFileSync(f.abs))
  }
  return h.digest('hex').slice(0, 8)
}

const FONT_TYPES: Record<string, string> = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }

export function excalidrawAssetsPlugin(opts: ExcalidrawAssetsOptions = {}): Plugin {
  let files: FontFile[] = []
  let assetDir = '' // e.g. `assets/excalidraw-1a2b3c4d/`
  return {
    name: 'md-reader-excalidraw-assets',
    config(config) {
      const root = path.resolve(config.root ?? process.cwd())
      files = listFontFiles(excalidrawProdDir(root), opts.skipFamilies)
      assetDir = `assets/excalidraw-${fontSetHash(files)}/`
      return { define: { __MDR_EXCALIDRAW_ASSETS__: JSON.stringify(assetDir) } }
    },
    configureServer(server) {
      const byRel = new Map(files.map((f) => [f.rel, f.abs]))
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        const prefix = server.config.base + assetDir
        const abs = pathname.startsWith(prefix) ? byRel.get(pathname.slice(prefix.length)) : undefined
        if (!abs) return next()
        res.setHeader('Content-Type', FONT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
        fs.createReadStream(abs).pipe(res)
      })
    },
    generateBundle() {
      for (const f of files) {
        this.emitFile({ type: 'asset', fileName: assetDir + f.rel, source: fs.readFileSync(f.abs) })
      }
    },
  }
}
