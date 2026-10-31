import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { swPrecachePlugin } from './scripts/build/sw-precache'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/themarkdownreader/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Inlines this build's precache manifest into dist/sw.js (offline support).
    swPrecachePlugin(),
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
    // The web app lives entirely in `src/`. Sibling tool dirs (the VS Code
    // extension — which downloads a full ~900-dir VS Code under
    // .wdio-vscode-service — the CLI, MCP server, and workspace packages) are
    // not imported by the app, but Vite's file watcher would still recurse
    // into them and exhaust the host's inotify limit, crashing `npm run dev`
    // with EMFILE. Ignoring them keeps the dev server runnable on the host.
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/vscode-extension/**',
        '**/packages/**',
        '**/cli/**',
        '**/mcp-server/**',
        '**/claude-code-plugin/**',
        '**/e2e/**',
        '**/e2e-hosted/**',
        '**/test-results/**',
        '**/.playwright-mcp/**',
      ],
    },
  },
  optimizeDeps: {
    include: ['markmap-common', 'markmap-lib', 'markmap-view'],
  },
  build: {
    sourcemap: 'hidden',
    rolldownOptions: {
      output: {
        // Rolldown groups also capture every dependency of the modules they
        // match (includeDependenciesRecursively defaults to true), so a module
        // shared by several groups lands in whichever group claims it first.
        // With the old single manualChunks() function, the excalidraw group
        // swallowed React, react-dom, Vite's preload helper and mermaid's
        // core, so the entry (and every mermaid diagram) statically imported
        // the 4.7 MB excalidraw chunk. Priorities fix the claim order:
        //   1. react-vendor — shared runtime every chunk needs (boot path)
        //   2. leaf libraries other groups depend on (katex, d3, mermaid)
        //   3. feature vendors (excalidraw, markdown, markmap, AI runtimes)
        // @excalidraw/mermaid-to-excalidraw is left to automatic chunking:
        // excalidraw only import()s it from its text-to-diagram dialog, and
        // capturing it would turn that lazy edge into a static
        // excalidraw -> mermaid import.
        // Chunk names are load-bearing: scripts/build/sw-precache.ts matches
        // on them.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]|^\0vite[\\/]preload-helper/,
              priority: 30,
            },
            { name: 'katex', test: /[\\/]node_modules[\\/]katex[\\/]/, priority: 20 },
            { name: 'd3', test: /[\\/]node_modules[\\/]d3/, priority: 20 },
            { name: 'mermaid', test: /[\\/]node_modules[\\/](mermaid|@mermaid-js)[\\/]/, priority: 15 },
            {
              name: 'excalidraw',
              test: (id) => /[\\/]node_modules[\\/]@excalidraw[\\/]/.test(id) && !/[\\/]@excalidraw[\\/]mermaid-to-excalidraw[\\/]/.test(id),
              priority: 10,
            },
            { name: 'markmap', test: /[\\/]node_modules[\\/]markmap/, priority: 10 },
            { name: 'graphology', test: /[\\/]node_modules[\\/]graphology/, priority: 10 },
            { name: 'markdown', test: /[\\/]node_modules[\\/](react-markdown|remark|rehype|unified)/, priority: 10 },
            { name: 'transformers', test: /[\\/]node_modules[\\/]@huggingface[\\/]transformers[\\/]/, priority: 10 },
            { name: 'webllm', test: /[\\/]node_modules[\\/]@mlc-ai[\\/]/, priority: 10 },
            { name: 'posthog', test: /[\\/]node_modules[\\/]posthog/, priority: 10 },
          ],
        },
      },
    },
  },
})
