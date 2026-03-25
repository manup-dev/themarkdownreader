import { build } from 'esbuild'

// Bundle markmap into a single IIFE for the Chrome extension
// This avoids CSP issues with loading from CDN
await build({
  entryPoints: ['browser-extension/markmap-bundle-src.js'],
  bundle: true,
  format: 'iife',
  globalName: 'MarkmapBundle',
  outfile: 'browser-extension/markmap-bundle.js',
  minify: true,
  target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"' },
})

console.log('✓ markmap-bundle.js built')
