import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        },
      },
    },
  },
})
