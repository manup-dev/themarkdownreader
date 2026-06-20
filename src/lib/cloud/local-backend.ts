/**
 * Default `CloudBackend` for the free, local-first public app. No network, no
 * auth, no secrets. Sync/library/share/AI-proxy are cloud-only and reject with
 * `CloudUnavailableError`; the reader itself never calls them in local mode.
 */

import type { AnnotationEvent } from '../annotation-events'
import {
  CloudUnavailableError,
  type CloudAuthState,
  type CloudBackend,
  type CloudDocumentRef,
  type CloudAiRequest,
  type PersistentShare,
  type PersistentShareOptions,
  type PullResult,
  type PushResult,
  type SyncCursor,
} from './types'

const LOCAL_STATE: CloudAuthState = { mode: 'local', user: null, org: null }

export class LocalCloudBackend implements CloudBackend {
  readonly mode = 'local' as const

  getAuthState(): CloudAuthState {
    return LOCAL_STATE
  }

  onAuthChange(_listener: (state: CloudAuthState) => void): () => void {
    // Local mode never changes auth state — nothing to emit, nothing to clean up.
    return () => {}
  }

  async signIn(): Promise<void> {
    throw new CloudUnavailableError('Sign in')
  }

  async signOut(): Promise<void> {
    // Idempotent no-op: signing out of "nothing" succeeds.
  }

  async listDocuments(): Promise<CloudDocumentRef[]> {
    return []
  }

  async pushEvents(
    _docKey: string,
    _events: AnnotationEvent[],
  ): Promise<PushResult> {
    throw new CloudUnavailableError('Cloud sync')
  }

  async pullEvents(_docKey: string, _since?: SyncCursor): Promise<PullResult> {
    throw new CloudUnavailableError('Cloud sync')
  }

  async createPersistentShare(
    _docKey: string,
    _options: PersistentShareOptions,
  ): Promise<PersistentShare> {
    throw new CloudUnavailableError('Persistent share links')
  }

  // eslint-disable-next-line require-yield
  async *aiProxy(_request: CloudAiRequest): AsyncIterable<string> {
    throw new CloudUnavailableError('Managed AI')
  }
}
