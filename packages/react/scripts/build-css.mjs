#!/usr/bin/env node
// Build a single self-contained CSS bundle for md-reader, with every selector
// scoped under `.md-reader-jupyter`. Embedders (Jupyter, VS Code webview, etc.)
// import this from `@md-reader/react/styles.css`.
//
// Pipeline:
//   1. Compile root `src/index.css` with @tailwindcss/cli, scanning root src/.
//   2. Run the result through postcss + postcss-prefix-selector so every rule
//      lives under `.md-reader-jupyter` (and `:root`/`html`/`body` collapse
//      to the wrapper itself).
//
// Idempotent: safe to re-run. Self-contained: no shell expansion tricks.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const repoRoot = resolve(pkgRoot, '../..')
const inputCss = resolve(repoRoot, 'src/index.css')
const distDir = resolve(pkgRoot, 'dist')
const rawCss = resolve(distDir, 'styles.raw.css')
const outCss = resolve(distDir, 'styles.css')
const contentGlob = resolve(repoRoot, 'src/**/*.{ts,tsx}')

const PREFIX = '.md-reader-jupyter'

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

function runTailwind() {
  if (!existsSync(inputCss)) {
    throw new Error(`Missing input CSS at ${inputCss}`)
  }
  // Use the workspace-installed @tailwindcss/cli (already a devDep at repo
  // root: `@tailwindcss/vite` brings tailwindcss 4.x). We invoke via npx so
  // we don't require an extra dep in this package.
  const cmd = [
    'npx',
    '-y',
    '@tailwindcss/cli@^4',
    '-i',
    JSON.stringify(inputCss),
    '-o',
    JSON.stringify(rawCss),
    '--content',
    JSON.stringify(contentGlob),
  ].join(' ')
  execSync(cmd, { stdio: 'inherit', cwd: repoRoot })
}

async function runPrefix() {
  const { default: postcss } = await import('postcss')
  const { default: prefixer } = await import('postcss-prefix-selector')

  const css = readFileSync(rawCss, 'utf8')
  const transform = (prefix, selector, prefixedSelector) => {
    if (selector === ':root' || selector === 'html' || selector === 'body') return prefix
    if (selector.startsWith('@')) return selector
    return prefixedSelector
  }
  const result = await postcss([prefixer({ prefix: PREFIX, transform })]).process(css, {
    from: rawCss,
    to: outCss,
  })
  writeFileSync(outCss, result.css, 'utf8')
}

async function main() {
  ensureDir(distDir)
  runTailwind()
  await runPrefix()
  const bytes = statSync(outCss).size
  console.log(`@md-reader/react: wrote ${outCss} (${(bytes / 1024).toFixed(1)} KB)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
