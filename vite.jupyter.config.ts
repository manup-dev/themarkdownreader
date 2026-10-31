// Vite config for the iframe-embedded JupyterLab build of md-reader.
//
// Differences vs. the standard build:
//   - `base: './'`  → relative asset paths so the bundle works under
//     `/lab/extensions/@md-reader/jupyterlab/static/app/...`.
//   - `build.outDir: 'dist-jupyter'` so we don't clobber the main `dist/`.
//   - `define.MDR_HOST = '"jupyterlab"'` for runtime host detection.
//   - `define.MDR_TELEMETRY = '0'` to tree-shake PostHog.
//   - PostHog import becomes a no-op `data:` shim so `import 'posthog-js'`
//     resolves but contributes nothing to the bundle.
//   - codeSplitting groups shared with the web build
//     (scripts/build/chunk-groups.ts) keep heavy AI/excalidraw/mermaid/etc.
//     chunks off the boot path; bootPathGuardPlugin enforces it.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { excalidrawAssetsPlugin } from './scripts/build/excalidraw-assets'
import { bootPathGuardPlugin } from './scripts/build/boot-path-guard'
import { CHUNK_GROUPS } from './scripts/build/chunk-groups'

// Resolve `posthog-js` to a no-op shim so the iframe bundle doesn't ship
// 221KB of analytics. We use a virtual module rather than `define`
// because `import posthog from 'posthog-js'` produces a real namespace
// access that `define` can't statically replace.
const POSTHOG_SHIM = `
  const noop = () => {};
  const handler = { get: () => noop };
  const proxy = new Proxy(function(){}, handler);
  export default proxy;
  export const posthog = proxy;
`

function posthogShimPlugin() {
  const virtualId = '\0md-reader/posthog-shim'
  return {
    name: 'md-reader-posthog-shim',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (source === 'posthog-js' || source === 'posthog-js/dist/module.no-external')
        return virtualId
      return null
    },
    load(id: string) {
      if (id === virtualId) return POSTHOG_SHIM
      return null
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    'globalThis.MDR_HOST': '"jupyterlab"',
    'globalThis.MDR_TELEMETRY': '0',
    // Some libs (notably posthog-js) inspect process.env.NODE_ENV at runtime.
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [
    posthogShimPlugin(),
    react(),
    tailwindcss(),
    // Self-host excalidraw's fonts (no esm.sh). The CJK handwriting font
    // (Xiaolai, ~12.7 MB in 209 subsets) is left out to keep the wheel small;
    // CJK text in a diagram falls back to esm.sh for it.
    excalidrawAssetsPlugin({ skipFamilies: ['Xiaolai'] }),
    // Fails the build if a lazy-feature chunk lands on the boot path.
    bootPathGuardPlugin(),
  ],
  build: {
    outDir: 'dist-jupyter',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        // Same vendor layout as the web build (scripts/build/chunk-groups.ts),
        // plus kokoro-js, which only this build names explicitly.
        codeSplitting: {
          groups: [
            ...CHUNK_GROUPS,
            { name: 'kokoro', test: /[\\/]node_modules[\\/]kokoro-js[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
