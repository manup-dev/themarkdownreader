// Wire protocol between the JupyterLab host (parent window) and the
// md-reader app running inside the iframe. Versioned via PROTOCOL_VERSION
// so future breaking changes can be negotiated during the HELLO handshake.
//
// Every message is an `Envelope<T,P>` carrying a monotonically increasing
// `seq` from the sender; receivers drop replays where `seq <= lastSeqSeen`.

// Bumped to a real 1.x baseline now that the iframe + host can negotiate
// the wire format. v0.x of the package shipped a placeholder "2.0.0" during
// internal bring-up; collapsing back to semver-meaningful 1.0.0 before the
// first public tag so future bumps mean something to consumers.
export const PROTOCOL_VERSION = '1.0.0'

export interface Envelope<T extends string, P> {
  v: typeof PROTOCOL_VERSION
  seq: number
  ack?: number
  type: T
  ts: number
  payload: P
}

export type Ready = Envelope<
  'READY',
  {
    protocolVersions: string[]
    appBuild: string
    /**
     * Echoes the per-iframe nonce the host passed in the `?h=` URL parameter.
     * The host refuses to send HELLO if this doesn't match — proves the iframe
     * was actually loaded by *this* panel construction, not e.g. by a same-origin
     * page that opened the iframe URL on its own.
     */
    handshake: string
  }
>

export type Hello = Envelope<
  'HELLO',
  {
    acceptedVersion: string
    host: { name: 'jupyterlab'; version: string }
    capabilities: ('kernel' | 'persistence' | 'commands' | 'shortcuts')[]
    session: { sessionId: string; userId: string }
  }
>

export type SetMarkdown = Envelope<
  'SET_MARKDOWN',
  {
    docId: string
    path: string
    markdown: string
    mtime: number
    readOnly: boolean
  }
>

export type SetTheme = Envelope<
  'SET_THEME',
  {
    dark: boolean
    fontFamily: string
    fontSize: number
    jpVars: Record<string, string>
    highContrast: boolean
  }
>

export type SetSettings = Envelope<
  'SET_SETTINGS',
  {
    aiBackend: 'ollama' | 'openrouter' | 'webllm' | 'disabled'
    ollamaUrl?: string
    enabledFeatures: string[]
    telemetry: boolean
    kernelBridge: boolean
    companionPanel: boolean
  }
>

export type ScrollTo = Envelope<'SCROLL_TO', { anchor: string }>

/**
 * Pushed once after HELLO and on subsequent translator changes. Forwards
 * the host's active locale so the iframe app can localize its own UI in a
 * future release (v0.2.1+). The iframe app currently persists this but
 * does not act on it — purely plumbing.
 */
export type SetLocale = Envelope<'SET_LOCALE', { languageCode: string }>

export type OutlineUpdate = Envelope<
  'OUTLINE',
  { docId: string; headings: Array<{ id: string; text: string; level: number }> }
>

export type ErrorMsg = Envelope<
  'ERROR',
  {
    code: 'PROTOCOL' | 'AUTH' | 'NOT_READY' | 'INTERNAL'
    message: string
    ackSeq?: number
  }
>

export type HostMessage =
  | SetMarkdown
  | SetTheme
  | SetSettings
  | SetLocale
  | Hello
  | ScrollTo
  | ErrorMsg

export type ChildMessage = Ready | OutlineUpdate | ErrorMsg

export type AnyMessage = HostMessage | ChildMessage

export type MessageType = AnyMessage['type']

export function makeEnvelope<T extends string, P>(
  type: T,
  payload: P,
  seq: number,
  ack?: number,
): Envelope<T, P> {
  return {
    v: PROTOCOL_VERSION,
    seq,
    ack,
    type,
    ts: Date.now(),
    payload,
  }
}

/** Best-effort envelope validation; returns true if the shape is plausible. */
export function isEnvelope(x: unknown): x is Envelope<string, unknown> {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.v === 'string' &&
    typeof o.seq === 'number' &&
    typeof o.type === 'string' &&
    typeof o.ts === 'number' &&
    'payload' in o
  )
}
