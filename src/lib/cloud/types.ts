/**
 * The open-core seam between the free, local-first reader (this public repo)
 * and the proprietary hosted cloud (the private `md-reader-cloud` repo).
 *
 * NOTHING provider-specific lives here — no Clerk, no Azure, no URLs, no
 * secrets. The public app depends only on this interface and ships a no-op
 * `LocalCloudBackend` default (see ./local-backend). The hosted build injects
 * a real implementation at startup via `registerCloudBackend()`.
 *
 * Design note: cloud sync rides on the existing append-only annotation WAL
 * (src/lib/annotation-events.ts). Events are idempotent (dedup by `id`) and
 * conflict-free by construction, so the sync surface is a thin push/pull over
 * `AnnotationEvent[]` plus a monotonic server cursor — not a CRDT engine.
 * Live co-editing / presence is intentionally OUT OF SCOPE here.
 */

import type { AnnotationEvent } from '../annotation-events'

/** Whether a real cloud backend is wired in. `local` == this public app alone. */
export type CloudMode = 'local' | 'cloud'

/** Authenticated identity, provider-agnostic. Null when signed out / local. */
export interface CloudUser {
  /** Stable opaque id from the auth provider (e.g. Clerk user id). */
  id: string
  email: string
  name?: string
  avatarUrl?: string
}

/** Active org/workspace context for tenancy-scoped operations. */
export interface CloudOrg {
  id: string
  name: string
  /** Caller's role within the org. */
  role: 'owner' | 'admin' | 'member' | 'viewer'
  /** Org policy for how AI keys are sourced. Mirrors backend `key_policy`. */
  keyPolicy: 'org_key' | 'allow_byo' | 'managed_metered'
}

export interface CloudAuthState {
  mode: CloudMode
  user: CloudUser | null
  /** Current workspace; null for personal scope or when signed out. */
  org: CloudOrg | null
}

/** Opaque, monotonic sync cursor issued by the server. */
export type SyncCursor = string

export interface PullResult {
  events: AnnotationEvent[]
  /** Pass back on the next pull to fetch only newer events. */
  cursor: SyncCursor
  /** True when the server has more beyond this page. */
  hasMore: boolean
}

export interface PushResult {
  /** Cursor advanced to include the just-accepted events. */
  cursor: SyncCursor
  /** Count the server actually persisted (after idempotent dedup). */
  accepted: number
}

/** Summary row for the cloud document library. */
export interface CloudDocumentRef {
  id: string
  title: string
  contentHash: string
  updatedAt: number
}

export interface PersistentShareOptions {
  /** 'org' = members only, 'link' = anyone with the link, 'public' = indexed. */
  scope: 'org' | 'link' | 'public'
  /** Epoch ms; omit for no expiry. */
  expiresAt?: number
}

export interface PersistentShare {
  /** Durable URL that survives the browser tab (unlike self-contained #url=). */
  url: string
  slug: string
}

/** Provider-neutral AI proxy request — the server holds/selects the key. */
export interface CloudAiRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  signal?: AbortSignal
}

/**
 * The single interface the hosted build implements. Every method has a sane
 * local-mode fallback so the public app is fully functional with the default.
 */
export interface CloudBackend {
  readonly mode: CloudMode

  // ── Auth ────────────────────────────────────────────────────────────────
  getAuthState(): CloudAuthState
  /** Subscribe to auth changes; returns an unsubscribe fn. */
  onAuthChange(listener: (state: CloudAuthState) => void): () => void
  signIn(): Promise<void>
  signOut(): Promise<void>

  // ── Document library (cloud-persisted) ──────────────────────────────────
  listDocuments(): Promise<CloudDocumentRef[]>

  // ── Annotation sync (over the existing WAL) ─────────────────────────────
  pushEvents(docKey: string, events: AnnotationEvent[]): Promise<PushResult>
  pullEvents(docKey: string, since?: SyncCursor): Promise<PullResult>

  // ── Persistent sharing ──────────────────────────────────────────────────
  createPersistentShare(
    docKey: string,
    options: PersistentShareOptions,
  ): Promise<PersistentShare>

  // ── Managed AI proxy (key custody stays server-side) ────────────────────
  /** Streams assistant text chunks. Throws CloudUnavailableError in local mode. */
  aiProxy(request: CloudAiRequest): AsyncIterable<string>
}

/** Thrown by local-mode no-ops for cloud-only capabilities. */
export class CloudUnavailableError extends Error {
  constructor(capability: string) {
    super(
      `"${capability}" requires the hosted md-reader cloud and is not available in local mode.`,
    )
    this.name = 'CloudUnavailableError'
  }
}
