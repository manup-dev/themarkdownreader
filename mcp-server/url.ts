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

/**
 * Longest URL we pass to the OS `open` command. Windows cmd caps a command
 * line at 8191 chars; POSIX limits are higher but this keeps one bound
 * everywhere. Beyond this, callers must deliver the URL another way
 * (md-reader-mcp serves a local one-page redirect).
 */
export const INLINE_URL_MAX = 8000

/** base64 of JSON{markdown,fileName} — exactly what App.tsx's #md= handler
 *  decodes with atob + JSON.parse (UTF-8 bytes). Base64 output never
 *  contains '&', '#' or '?', so it can prefix ordinary hash params. */
export function encodeInlinePayload(markdown: string, fileName: string): string {
  return Buffer.from(JSON.stringify({ markdown, fileName }), 'utf-8').toString('base64')
}

/**
 * Build the hosted-app URL that carries the document content INLINE via the
 * #md= hash (the hosted Pages app has no /api/file endpoint, so #file=
 * paths only work against a local Vite dev server — C2).
 */
export function buildInlineReaderUrl(
  baseUrl: string,
  markdown: string,
  fileName: string,
  view: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ view, ...extra })
  return `${baseUrl}/#md=${encodeInlinePayload(markdown, fileName)}&${params.toString()}`
}
