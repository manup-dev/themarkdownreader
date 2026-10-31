import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { swPrecachePlugin } from './scripts/build/sw-precache'
import { excalidrawAssetsPlugin } from './scripts/build/excalidraw-assets'
import { bootPathGuardPlugin } from './scripts/build/boot-path-guard'
import { CHUNK_GROUPS } from './scripts/build/chunk-groups'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/themarkdownreader/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Serves excalidraw's fonts from our own origin instead of esm.sh.
    excalidrawAssetsPlugin(),
    // Fails the build if a lazy-feature chunk lands on the boot path.
    bootPathGuardPlugin(),
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
        // Shared with the JupyterLab build; see the file for why priorities matter.
        codeSplitting: { groups: CHUNK_GROUPS },
      },
    },
  },
})
