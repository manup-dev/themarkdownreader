import { defineConfig } from 'vitest/config'

// mcp-server is excluded from the root vitest run (see ../vitest.config.ts).
// This standalone config runs only the server's own Node-environment unit
// tests, executed via the repo's installed vitest binary from repo root:
//   npx vitest run --config mcp-server/vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['mcp-server/**/*.test.ts'],
  },
})
