// IFrameBridge is the iframe-side counterpart to the JupyterLab host's
// `MessageBridge`. It is lazy — only initialized when we detect we're in
// an iframe (`window.parent !== window`) — and pinned to its parent's
// origin so a third party can't hijack the channel.
//
// Wire protocol mirrors `packages/jupyterlab/src/protocol/messages.ts`.
// We keep this file dependency-free so it can run pre-React.

// Keep this in lockstep with `packages/jupyterlab/src/protocol/messages.ts`.
// A bump on either side must be matched on the other; see the protocol-
// mismatch branch in `onWindowMessage` for the user-visible failure mode.
const PROTOCOL_VERSION = '1.0.0'

interface Envelope<T extends string = string, P = unknown> {
  v: string
  seq: number
  ack?: number
  type: T
  ts: number
  payload: P
}

function isEnvelope(x: unknown): x is Envelope {
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

type Handler = (payload: unknown, env: Envelope) => void

export class IFrameBridge {
  private port: MessagePort | null = null
  private outSeq = 0
  private lastInSeq = -1
  private lastSessionId: string | null = null
  private handlers = new Map<string, Set<Handler>>()
  private parentOrigin = ''
  private readyResolved = false
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private windowListener: ((e: MessageEvent) => void) | null = null
  private portListener: ((e: MessageEvent) => void) | null = null
  private pagehideListener: (() => void) | null = null

  constructor() {
    this.readyPromise = new Promise<void>(res => {
      this.resolveReady = res
    })
  }

  /** Start the handshake by emitting READY to the parent. */
  start(): void {
    // Origin pinning strategy:
    //   1. Prefer `document.referrer` (most explicit signal from the
    //      browser as to who loaded us).
    //   2. Fall back to `window.location.origin` — when the parent
    //      sets `referrerpolicy="no-referrer"` on the iframe (which JL
    //      does by spec), document.referrer is the empty string. We
    //      know our iframe is hosted under the same JL origin via
    //      `/lab/extensions/...` so `window.location.origin` is a
    //      safe fallback for the same-origin case.
    //   3. If we can't even read `window.location.origin`, abort —
    //      `'*'` is never acceptable.
    try {
      if (document.referrer) {
        this.parentOrigin = new URL(document.referrer).origin
      } else if (window.location.origin && window.location.origin !== 'null') {
        this.parentOrigin = window.location.origin
      } else {
        this.parentOrigin = ''
      }
    } catch {
      this.parentOrigin = ''
    }
    this.windowListener = (e: MessageEvent) => this.onWindowMessage(e)
    window.addEventListener('message', this.windowListener)
    // Close the port on bf-cache eviction so a restored iframe doesn't keep
    // the channel half-open behind a stale host. The host has already torn
    // down its bridge by this point; re-handshake will happen on pageshow if
    // the iframe is restored.
    this.pagehideListener = () => {
      try {
        this.port?.close()
      } catch {
        // ignore
      }
      this.port = null
    }
    window.addEventListener('pagehide', this.pagehideListener)
    if (!this.parentOrigin) {
      // Couldn't determine parent origin — abort early. The host will
      // notice we never said READY and surface an error in its statusbar.
      console.warn('[md-reader/iframe] no parent origin; aborting bridge')
      return
    }
    // The host appends `?h=<nonce>` to the iframe URL on every panel
    // construction; echoing it in READY proves to the host that *this*
    // iframe document was loaded by *this* panel. Without it, a same-origin
    // page could load our iframe URL directly and impersonate the channel.
    const handshake = this.readHandshakeFromUrl()
    const ready: Envelope = {
      v: PROTOCOL_VERSION,
      seq: ++this.outSeq,
      type: 'READY',
      ts: Date.now(),
      payload: {
        protocolVersions: [PROTOCOL_VERSION],
        appBuild: (globalThis as Record<string, unknown>).MDR_HOST as string ?? 'jupyterlab',
        handshake,
      },
    }
    try {
      window.parent.postMessage(ready, this.parentOrigin)
    } catch (err) {
      console.warn('[md-reader/iframe] postMessage failed', err)
    }
  }

  on<P = unknown>(type: string, handler: (payload: P, env: Envelope) => void): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as Handler)
    return () => set!.delete(handler as Handler)
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  send(type: string, payload: unknown): void {
    if (!this.port) return
    const env: Envelope = {
      v: PROTOCOL_VERSION,
      seq: ++this.outSeq,
      type,
      ts: Date.now(),
      payload,
    }
    this.port.postMessage(env)
  }

  // ─── internals ───────────────────────────────────────────────────────
  private readHandshakeFromUrl(): string {
    try {
      return new URLSearchParams(window.location.search).get('h') ?? ''
    } catch {
      return ''
    }
  }

  private onWindowMessage(e: MessageEvent) {
    if (this.parentOrigin && e.origin !== this.parentOrigin) return
    if (!isEnvelope(e.data)) return
    const env = e.data
    if (env.v !== PROTOCOL_VERSION) {
      // Best-effort: tell the host we can't talk to it. Use the host's
      // version in the envelope so it parses on their end. Silently failing
      // here was the original bug — users got a blank iframe with no
      // diagnostic. Fail loud instead.
      console.warn(
        '[md-reader/iframe] protocol mismatch host=%s iframe=%s',
        env.v,
        PROTOCOL_VERSION,
      )
      try {
        window.parent.postMessage(
          {
            v: env.v,
            seq: ++this.outSeq,
            type: 'ERROR',
            ts: Date.now(),
            payload: {
              code: 'PROTOCOL',
              message: `iframe speaks ${PROTOCOL_VERSION}, host sent ${env.v}`,
            },
          },
          this.parentOrigin,
        )
      } catch {
        // ignore
      }
      return
    }
    if (env.type !== 'HELLO') return
    // Accept the transferred port.
    if (e.ports.length === 0) return
    // If the host has rotated its session (re-attach after dispose, bf-cache
    // restore, etc.), the sender's seq counter has reset to 0 — but we still
    // remember the previous session's max. Without this reset, the first
    // post-handshake message gets dropped as a replay.
    const helloPayload = env.payload as { session?: { sessionId?: string } } | undefined
    const sessionId = helloPayload?.session?.sessionId ?? null
    if (sessionId !== this.lastSessionId) {
      this.lastInSeq = -1
      this.lastSessionId = sessionId
    }
    this.port = e.ports[0]
    this.portListener = (ev: MessageEvent) => this.onPortMessage(ev)
    this.port.addEventListener('message', this.portListener)
    this.port.start()
    if (this.windowListener) {
      window.removeEventListener('message', this.windowListener)
      this.windowListener = null
    }
    if (!this.readyResolved) {
      this.readyResolved = true
      this.resolveReady()
    }
  }

  private onPortMessage(e: MessageEvent) {
    if (!isEnvelope(e.data)) return
    const env = e.data
    // Single-sender assumption — see the matching note in
    // `packages/jupyterlab/src/bridge/MessageBridge.ts` onPortMessage.
    // If the iframe ever opens additional channels (e.g. a worker
    // posting through a second port), this counter must shard per stream.
    if (env.seq <= this.lastInSeq) return
    this.lastInSeq = env.seq
    const set = this.handlers.get(env.type)
    if (!set) return
    for (const h of set) {
      try {
        h(env.payload, env)
      } catch (err) {
        console.warn('[md-reader/iframe] handler threw for', env.type, err)
      }
    }
  }
}

let _instance: IFrameBridge | null = null

/** Returns true iff we are running inside an iframe under a different parent. */
export function isIFrameMode(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    // Cross-origin iframe — calling window.parent throws in some browsers.
    return true
  }
}

export function getIFrameBridge(): IFrameBridge {
  if (!_instance) _instance = new IFrameBridge()
  return _instance
}
