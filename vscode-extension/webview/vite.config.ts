import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    modulePreload: { polyfill: false },
    target: 'es2020',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, '../../src'),
      // Force single React instance
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      // Resolve shared packages from base repo
      'd3': path.resolve(__dirname, '../../node_modules/d3'),
      'd3-hierarchy': path.resolve(__dirname, '../../node_modules/d3-hierarchy'),
      'lucide-react': path.resolve(__dirname, '../../node_modules/lucide-react'),
      'react-markdown': path.resolve(__dirname, '../../node_modules/react-markdown'),
      'remark-gfm': path.resolve(__dirname, '../../node_modules/remark-gfm'),
      'remark-math': path.resolve(__dirname, '../../node_modules/remark-math'),
      'remark-parse': path.resolve(__dirname, '../../node_modules/remark-parse'),
      'rehype-highlight': path.resolve(__dirname, '../../node_modules/rehype-highlight'),
      'rehype-katex': path.resolve(__dirname, '../../node_modules/rehype-katex'),
      'unified': path.resolve(__dirname, '../../node_modules/unified'),
      'markmap-lib': path.resolve(__dirname, '../../node_modules/markmap-lib'),
      'markmap-view': path.resolve(__dirname, '../../node_modules/markmap-view'),
      'zustand': path.resolve(__dirname, '../../node_modules/zustand'),
    },
  },
})
