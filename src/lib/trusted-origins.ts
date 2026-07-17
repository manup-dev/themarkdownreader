// Single allowlist for window.postMessage document injection
// (`md-reader-load`). Shared by App.tsx (listener active on every screen)
// and Upload.tsx (upload-screen listener) so the two can never drift (B7).
// Origins:
//  - our own origin: browser-extension #ext-pending flow and E2E harnesses
//    post from the app page itself
//  - github.com: the browser-extension content script posts into the app
//    tab it opened from a GitHub page
//  - localhost:5180 / 5173: mdonline collaborative editor + Vite dev
//    (same machine, different port) — see commit 851751a
export function trustedEmbedOrigins(): string[] {
  return [
    window.location.origin,
    'https://github.com',
    'http://localhost:5180',
    'http://localhost:5173',
  ]
}

export function isTrustedEmbedOrigin(origin: string): boolean {
  return trustedEmbedOrigins().includes(origin)
}
