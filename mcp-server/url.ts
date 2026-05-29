/**
 * Build the md-reader browser URL that loads a file into a given view.
 * Mirrors the hash-route the SPA reads (`#file=…&view=…`) and the params
 * the dev server's /api/file loader expects. Pure — no Node/SDK deps — so
 * it can be unit-tested in isolation.
 */
export function buildReaderUrl(
  baseUrl: string,
  relativePath: string,
  view: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ file: relativePath, view, ...extra })
  return `${baseUrl}/#${params.toString()}`
}
