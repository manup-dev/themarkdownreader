import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Load visualizer only when ANALYZE is set — avoids crash when not installed (e.g. Docker)
async function getAnalyzerPlugin(): Promise<PluginOption[]> {
  if (!process.env.ANALYZE) return []
  try {
    const { visualizer } = await import('rollup-plugin-visualizer')
    return [visualizer({ open: true, gzipSize: true, filename: 'dist/bundle-stats.html' })]
  } catch { return [] }
}

export default defineConfig(async () => ({
  base: process.env.GITHUB_ACTIONS ? '/themarkdownreader/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    ...(await getAnalyzerPlugin()),
    {
      name: 'md-reader-file-api',
      configureServer(server) {
        server.middlewares.use('/api/file', (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = url.searchParams.get('path')

          if (!filePath) {
            res.statusCode = 400
            res.end('Missing ?path= parameter')
            return
          }

          const resolved = path.resolve(filePath)
          const rootWithSlash = server.config.root + (server.config.root.endsWith('/') ? '' : '/')

          // Security: must be within project root and be a .md file
          if (!resolved.startsWith(rootWithSlash)) {
            res.statusCode = 403
            res.end('Path outside project root')
            return
          }
          if (!resolved.endsWith('.md')) {
            res.statusCode = 400
            res.end('Only .md files are supported')
            return
          }
          if (!fs.existsSync(resolved)) {
            res.statusCode = 404
            res.end('File not found')
            return
          }

          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(fs.readFileSync(resolved, 'utf-8'))
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5183,
  },
  optimizeDeps: {
    include: ['markmap-common', 'markmap-lib', 'markmap-view'],
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/d3')) return 'd3'
          if (id.includes('node_modules/markmap')) return 'markmap'
          if (id.includes('node_modules/graphology')) return 'graphology'
          if (id.includes('node_modules/@excalidraw')) return 'excalidraw'
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark') || id.includes('node_modules/rehype') || id.includes('node_modules/unified')) return 'markdown'
          if (id.includes('node_modules/@huggingface/transformers')) return 'transformers'
          if (id.includes('node_modules/@mlc-ai')) return 'webllm'
          if (id.includes('node_modules/katex')) return 'katex'
          if (id.includes('node_modules/posthog')) return 'posthog'
        },
      },
    },
  },
}))
