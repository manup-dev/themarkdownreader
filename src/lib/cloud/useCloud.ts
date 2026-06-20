/**
 * React binding for the cloud seam. Components read auth/cloud state with
 * `useCloud()`; it stays correct whether the local no-op or the hosted backend
 * is active, and re-renders on sign-in/out via the backend's own subscription.
 */

import { useSyncExternalStore } from 'react'
import { getCloudBackend } from './registry'
import type { CloudAuthState, CloudBackend } from './types'

function subscribe(onChange: () => void): () => void {
  // Re-resolve the backend on each subscribe so a registration that happens
  // before render is picked up; the backend drives change notifications.
  return getCloudBackend().onAuthChange(onChange)
}

function getSnapshot(): CloudAuthState {
  return getCloudBackend().getAuthState()
}

export interface UseCloud extends CloudAuthState {
  /** The active backend, for imperative calls (signIn, sync, share, …). */
  backend: CloudBackend
  /** Convenience: true when a real hosted backend is wired in. */
  enabled: boolean
  /** Convenience: true when a user is authenticated. */
  signedIn: boolean
}

export function useCloud(): UseCloud {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const backend = getCloudBackend()
  return {
    ...state,
    backend,
    enabled: backend.mode === 'cloud',
    signedIn: state.user !== null,
  }
}
