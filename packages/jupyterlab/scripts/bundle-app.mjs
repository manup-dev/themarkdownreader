#!/usr/bin/env node
// Copies the iframe-mode build of the md-reader web app
// (<repo>/dist-jupyter/*) into the labextension static dir so JupyterLab
// can serve it at /lab/extensions/@md-reader/jupyterlab/static/app/...
//
// Also writes a `manifest.json` with the build hash + ISO timestamp so the
// parent extension can sanity-check version drift at runtime if it ever
// wants to.

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// packages/jupyterlab/scripts/  →  repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC = path.join(REPO_ROOT, 'dist-jupyter')
const DEST = path.resolve(
  __dirname,
  '..',
  'jupyterlab_md_reader',
  'labextension',
  'static',
  'app',
)

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function rimraf(dir) {
  if (!(await pathExists(dir))) return
  await fs.rm(dir, { recursive: true, force: true })
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(s, d)
    } else if (entry.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}

async function hashTree(root) {
  const h = createHash('sha1')
  async function walk(p) {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) {
      const entries = (await fs.readdir(p)).sort()
      for (const e of entries) await walk(path.join(p, e))
    } else if (stat.isFile()) {
      h.update(path.relative(root, p))
      h.update(await fs.readFile(p))
    }
  }
  await walk(root)
  return h.digest('hex').slice(0, 16)
}

async function sizeTree(root) {
  let bytes = 0
  let files = 0
  async function walk(p) {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) {
      for (const e of await fs.readdir(p)) await walk(path.join(p, e))
    } else if (stat.isFile()) {
      bytes += stat.size
      files += 1
    }
  }
  await walk(root)
  return { bytes, files }
}

/**
 * Sanity-check that every script/link/img reference in `index.html` resolves
 * to a real file inside the build output. A failed/interrupted Vite build
 * can leave a stale `dist-jupyter/index.html` pointing at hashed chunks
 * that never landed, and the `?v=` cache-buster won't save you because
 * both builds carry the same version. Catching the broken bundle here is
 * cheaper than chasing white-screen reports.
 */
async function preflightAssets(srcDir) {
  const indexPath = path.join(srcDir, 'index.html')
  if (!(await pathExists(indexPath))) {
    throw new Error(`bundle-app: ${indexPath} missing — Vite produced no index.html`)
  }
  const html = await fs.readFile(indexPath, 'utf8')
  // Match src="…" and href="…" — skip absolute URLs and data: URIs.
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
    .map(m => m[1])
    .filter(r => r && !r.startsWith('http://') && !r.startsWith('https://') && !r.startsWith('data:') && !r.startsWith('//'))
  const missing = []
  for (const ref of refs) {
    // Strip query/hash and leading './' so a `./assets/foo.js?v=…` reference
    // resolves against the build dir.
    const clean = ref.split('#')[0].split('?')[0].replace(/^\.?\/+/, '')
    if (!clean) continue
    if (!(await pathExists(path.join(srcDir, clean)))) {
      missing.push(ref)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `bundle-app: index.html references ${missing.length} missing asset(s):\n  - ${missing.join('\n  - ')}\n` +
      'A previous build likely failed mid-flight. Try: rm -rf dist-jupyter && npm run build:jupyter',
    )
  }
  console.log(`[bundle-app] preflight: ${refs.length} index.html references all resolve`)
}

async function main() {
  if (!(await pathExists(SRC))) {
    console.error(`[bundle-app] ${SRC} does not exist.`)
    console.error('[bundle-app] Run `npm run build:jupyter` first.')
    process.exit(1)
  }
  await preflightAssets(SRC)
  console.log(`[bundle-app] src:  ${SRC}`)
  console.log(`[bundle-app] dest: ${DEST}`)
  await rimraf(DEST)
  await copyDir(SRC, DEST)
  const hash = await hashTree(DEST)
  const { bytes, files } = await sizeTree(DEST)
  const manifest = {
    name: '@md-reader/jupyterlab-app',
    hash,
    files,
    bytes,
    builtAt: new Date().toISOString(),
  }
  await fs.writeFile(
    path.join(DEST, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  const mb = (bytes / 1024 / 1024).toFixed(2)
  console.log(`[bundle-app] copied ${files} files, ${mb} MB, hash=${hash}`)
}

main().catch(err => {
  console.error('[bundle-app] failed:', err)
  process.exit(1)
})
