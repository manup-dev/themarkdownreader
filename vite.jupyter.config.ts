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
//   - manualChunks: keep heavy AI/transformer/excalidraw/etc. in separate
//     chunks so the initial chunk stays lean.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  ],
  build: {
    outDir: 'dist-jupyter',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/d3')) return 'd3'
          if (id.includes('node_modules/markmap')) return 'markmap'
          if (id.includes('node_modules/graphology')) return 'graphology'
          if (id.includes('node_modules/@excalidraw')) return 'excalidraw'
          if (id.includes('node_modules/mermaid') || id.includes('node_modules/@mermaid-js')) return 'mermaid'
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark') ||
            id.includes('node_modules/rehype') ||
            id.includes('node_modules/unified')
          ) return 'markdown'
          if (id.includes('node_modules/@huggingface/transformers')) return 'transformers'
          if (id.includes('node_modules/@mlc-ai')) return 'webllm'
          if (id.includes('node_modules/kokoro-js')) return 'kokoro'
          if (id.includes('node_modules/katex')) return 'katex'
        },
      },
    },
  },
})
