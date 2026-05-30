# @md-reader/react

React 19 components and the `MdReaderProvider` for embedding md-reader inside any host shell (web, VS Code webview, JupyterLab widget, Electron).

## Install

```bash
npm install @md-reader/react @md-reader/core
```

`react` and `react-dom` (>=19) are peer dependencies.

## Usage

```tsx
import { MdReaderProvider, Reader, Toolbar } from '@md-reader/react'
import type { StorageAdapter } from '@md-reader/core'
import '@md-reader/react/styles.css'

function App({ adapter }: { adapter: StorageAdapter }) {
  return (
    <div className="md-reader-jupyter" style={{ height: '100%' }}>
      <MdReaderProvider adapter={adapter}>
        <Toolbar />
        <Reader />
      </MdReaderProvider>
    </div>
  )
}
```

The compiled stylesheet (`@md-reader/react/styles.css`) is fully scoped under `.md-reader-jupyter` so it never leaks into a host's chrome. Host code is responsible for adding that class to a wrapper element and providing a `StorageAdapter` (in-memory, IndexedDB, or sidecar).

## Build the stylesheet

```bash
npm run build:css
```

Output: `dist/styles.css`.

Phase 0 ships this package as a workspace shim pointing at the existing repo `src/`. Source will physically relocate in a later phase without changing the public surface.
