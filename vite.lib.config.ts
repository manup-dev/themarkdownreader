import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: [
        'src/index.ts',
        'src/types/**',
        'src/provider/**',
        'src/adapters/**',
        'src/lib/anchor.ts',
        'src/lib/markdown.ts',
      ],
      tsconfigPath: './tsconfig.app.json',
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'md-reader',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        /^react-markdown/,
        /^remark-/,
        /^rehype-/,
        /^unified/,
        /^d3/,
        /^graphology/,
        /^markmap/,
        /^@excalidraw/,
        /^@huggingface/,
        /^@mlc-ai/,
        /^kokoro/,
        /^@ain1084/,
        'dexie',
        'zustand',
        'posthog-js',
        'minisearch',
        'lucide-react',
        'murmurhash-js',
        'umap-js',
      ],
    },
    outDir: 'dist-lib',
    sourcemap: true,
  },
})
