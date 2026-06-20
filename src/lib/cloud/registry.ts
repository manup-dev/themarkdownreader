/**
 * Injection point for the hosted build. The public app calls
 * `getCloudBackend()` everywhere; it returns `LocalCloudBackend` until the
 * private `@mdreader/cloud` module calls `registerCloudBackend()` once at
 * startup (before React renders). This is the ONE hook the proprietary repo
 * needs — everything else is the interface in ./types.
 */

import { LocalCloudBackend } from './local-backend'
import type { CloudBackend } from './types'

const localDefault = new LocalCloudBackend()
let active: CloudBackend = localDefault

/**
 * Install the real cloud backend. Call once during hosted bootstrap, before
 * the first `getCloudBackend()` consumer renders. Idempotent-safe to call
 * again (e.g. HMR) — last registration wins.
 */
export function registerCloudBackend(backend: CloudBackend): void {
  active = backend
}

/** Current backend — the local no-op unless the hosted build injected one. */
export function getCloudBackend(): CloudBackend {
  return active
}

/** True when a real (non-local) backend is wired in. */
export function isCloudEnabled(): boolean {
  return active.mode === 'cloud'
}

/** Test/teardown helper: restore the local default. */
export function resetCloudBackend(): void {
  active = localDefault
}
