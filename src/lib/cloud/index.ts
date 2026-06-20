/**
 * Open-core cloud seam. The free local-first app uses the no-op default; the
 * proprietary hosted build (private `md-reader-cloud` repo) injects a real
 * `CloudBackend` via `registerCloudBackend()`. No secrets or provider code
 * ever live in this public package.
 */

export * from './types'
export { LocalCloudBackend } from './local-backend'
export {
  getCloudBackend,
  registerCloudBackend,
  isCloudEnabled,
  resetCloudBackend,
} from './registry'
export { useCloud, type UseCloud } from './useCloud'
