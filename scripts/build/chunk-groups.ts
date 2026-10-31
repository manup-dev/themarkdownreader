// Vendor chunk layout shared by the web build (vite.config.ts) and the
// JupyterLab build (vite.jupyter.config.ts), passed as
// build.rolldownOptions.output.codeSplitting.groups.
//
// Rolldown groups also capture every dependency of the modules they match
// (includeDependenciesRecursively defaults to true), so a module shared by
// several groups lands in whichever group claims it first. With the old
// manualChunks() function, the excalidraw group swallowed React, react-dom,
// Vite's preload helper and mermaid's core, so the entry (and every mermaid
// diagram) statically imported the 4.7 MB excalidraw chunk. Priorities fix
// the claim order:
//   1. react-vendor: shared runtime every chunk needs (boot path)
//   2. leaf libraries other groups depend on (katex, d3, mermaid)
//   3. feature vendors (excalidraw, markdown, markmap, AI runtimes)
// @excalidraw/mermaid-to-excalidraw is left to automatic chunking:
// excalidraw only import()s it from its text-to-diagram dialog, and capturing
// it would turn that lazy edge into a static excalidraw -> mermaid import.
//
// Chunk names are load-bearing: sw-precache.ts and boot-path-guard.ts match
// on them. bootPathGuardPlugin() fails the build if this layout regresses.

import type { Rolldown } from 'vite'

export const CHUNK_GROUPS: Rolldown.CodeSplittingGroup[] = [
  {
    // Plus tiny runtime helpers app code and vendors share: Vite's preload
    // helper and, when transpiling down (the JupyterLab build targets
    // es2020), oxc's helpers, e.g. defineProperty for class fields, which
    // mermaid's group otherwise claimed, dragging mermaid + d3 onto the boot path.
    name: 'react-vendor',
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]|^\0vite[\\/]preload-helper|^\0@oxc-project\+runtime@/,
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
]
