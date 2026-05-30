// MessageBridge owns the postMessage handshake between the JupyterLab host
// and the iframe-embedded md-reader app, then hands off to a
// MessageChannel for ordered, origin-isolated traffic.
//
// Lifecycle:
//   1. Host calls `attach(iframe, expectedOrigin)`.
//   2. Iframe child posts a `READY` envelope via `window.postMessage`.
//   3. Bridge validates origin + envelope, posts a `HELLO` back, and
//      transfers `port2` of a fresh MessageChannel.
//   4. All subsequent traffic flows through the port. The original
//      `window.postMessage` listener is detached.
//
// Sequence numbers are tracked per-direction; replays (seq <= lastSeen) are
// dropped. The bridge is fully disposable and tears down listeners + port.

import {
  PROTOCOL_VERSION,
  isEnvelope,
  makeEnvelope,
  type AnyMessage,
  type MessageType,
  type Envelope,
} from '../protocol/messages'

const DEBUG =
  typeof globalThis !== 'undefined' &&
  (globalThis as Record<string, unknown>).MDR_DEBUG === true

export interface HelloPayload {
  host: { name: 'jupyterlab'; version: string }
  capabilities: ('kernel' | 'persistence' | 'commands' | 'shortcuts')[]
  session: { sessionId: string; userId: string }
}

type Handler = (payload: unknown, env: Envelope<string, unknown>) => void

export interface ProtocolError {
  code: 'PROTOCOL' | 'AUTH' | 'NOT_READY' | 'INTERNAL'
  message: string
}

export class MessageBridge {
  private iframe: HTMLIFrameElement | null = null
  private expectedOrigin = ''
  // Per-attach nonce — the iframe must echo this in its READY payload or we
  // refuse to open the channel. Stops a same-origin attacker from posting a
  // hand-crafted READY at a panel they don't own.
  private expectedHandshake = ''
  private port: MessagePort | null = null
  private channel: MessageChannel | null = null
  private outSeq = 0
  private lastInSeq = -1
  private handlers = new Map<MessageType, Set<Handler>>()
  private readyHandlers = new Set<() => void>()
  private errorHandlers = new Set<(e: ProtocolError) => void>()
  private windowListener: ((e: MessageEvent) => void) | null = null
  private portListener: ((e: MessageEvent) => void) | null = null
  private disposed = false
  private ready = false
  private helloPayload: HelloPayload | null = null

  attach(
    iframe: HTMLIFrameElement,
    expectedOrigin: string,
    hello: HelloPayload,
    expectedHandshake: string,
  ): void {
    if (this.disposed) throw new Error('MessageBridge is disposed')
    this.iframe = iframe
    this.expectedOrigin = expectedOrigin
    this.expectedHandshake = expectedHandshake
    this.helloPayload = hello
    this.windowListener = (e: MessageEvent) => this.onWindowMessage(e)
    window.addEventListener('message', this.windowListener)
  }

  /** Listen for incoming messages of a given type. */
  on<P = unknown>(type: MessageType, handler: (payload: P, env: Envelope<string, unknown>) => void): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as Handler)
    return () => set!.delete(handler as Handler)
  }

  /** Listen for the channel becoming live (post-HELLO). */
  onReady(handler: () => void): () => void {
    if (this.ready) {
      handler()
      return () => {}
    }
    this.readyHandlers.add(handler)
    return () => this.readyHandlers.delete(handler)
  }

  /**
   * Listen for protocol-level failures (mismatched version, bad handshake,
   * malformed envelope). Caller is expected to surface this in the UI
   * (status item, notification). Handler is invoked at most once per error.
   */
  onError(handler: (e: ProtocolError) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  isReady(): boolean {
    return this.ready
  }

  /** Send a typed message. Silently dropped pre-handshake or post-dispose. */
  send<P>(type: MessageType, payload: P): void {
    if (this.disposed) return
    const env = makeEnvelope(type, payload, ++this.outSeq)
    if (this.port) {
      this.port.postMessage(env)
      return
    }
    // Pre-handshake fallback (e.g., for ERROR before READY)
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage(env, this.expectedOrigin)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.windowListener) {
      window.removeEventListener('message', this.windowListener)
      this.windowListener = null
    }
    if (this.port && this.portListener) {
      try {
        this.port.removeEventListener('message', this.portListener)
      } catch {
        // ignore
      }
    }
    try {
      this.port?.close()
    } catch {
      // ignore
    }
    this.port = null
    this.channel = null
    this.handlers.clear()
    this.readyHandlers.clear()
    this.errorHandlers.clear()
    this.iframe = null
  }

  private emitError(err: ProtocolError): void {
    for (const h of this.errorHandlers) {
      try {
        h(err)
      } catch (e) {
        if (DEBUG) console.warn('[md-reader] onError handler threw', e)
      }
    }
  }

  // ─── internals ─────────────────────────────────────────────────────────
  private onWindowMessage(e: MessageEvent) {
    if (this.disposed) return
    // Origin pin — never accept '*'.
    if (this.expectedOrigin && e.origin !== this.expectedOrigin) return
    if (!isEnvelope(e.data)) return
    const env = e.data as Envelope<string, unknown>
    if (env.v !== PROTOCOL_VERSION) {
      // The iframe is built and shipped together with this code, so any
      // version skew is a bug or a stale bf-cached iframe under a freshly
      // upgraded host. Surface to the user so they don't stare at a blank
      // panel.
      const msg = `Unsupported protocol version: iframe=${env.v}, host=${PROTOCOL_VERSION}`
      this.send('ERROR', { code: 'PROTOCOL', message: msg })
      this.emitError({ code: 'PROTOCOL', message: msg })
      return
    }
    // The iframe is allowed to send ERROR back to us pre-handshake (e.g.,
    // protocol mismatch detected from the *iframe's* side). Route it.
    if (env.type === 'ERROR') {
      const p = env.payload as Partial<ProtocolError> | undefined
      this.emitError({
        code: (p?.code as ProtocolError['code']) || 'INTERNAL',
        message: p?.message || 'iframe reported an unspecified error',
      })
      return
    }
    if (env.type !== 'READY') return
    // Validate the handshake nonce — refuse to open the channel for a
    // READY that didn't echo the per-iframe nonce we put in the URL.
    const readyPayload = env.payload as { handshake?: string } | undefined
    if (
      this.expectedHandshake &&
      readyPayload?.handshake !== this.expectedHandshake
    ) {
      const msg = 'iframe READY did not echo the expected handshake nonce'
      if (DEBUG) console.warn('[md-reader]', msg, readyPayload)
      this.emitError({ code: 'AUTH', message: msg })
      return
    }
    // READY received: open channel, transfer port2, dispatch HELLO.
    this.channel = new MessageChannel()
    this.port = this.channel.port1
    this.portListener = (ev: MessageEvent) => this.onPortMessage(ev)
    this.port.addEventListener('message', this.portListener)
    this.port.start()
    const hello = makeEnvelope(
      'HELLO',
      {
        acceptedVersion: PROTOCOL_VERSION,
        ...this.helloPayload!,
      },
      ++this.outSeq,
      env.seq,
    )
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage(hello, this.expectedOrigin, [this.channel.port2])
    }
    // Tear down window listener — channel takes over.
    if (this.windowListener) {
      window.removeEventListener('message', this.windowListener)
      this.windowListener = null
    }
    this.ready = true
    for (const h of this.readyHandlers) {
      try {
        h()
      } catch (err) {
        if (DEBUG) console.warn('[md-reader] onReady handler threw', err)
      }
    }
    this.readyHandlers.clear()
  }

  private onPortMessage(e: MessageEvent) {
    if (this.disposed) return
    if (!isEnvelope(e.data)) return
    const env = e.data as Envelope<string, unknown>
    if (env.v !== PROTOCOL_VERSION) return
    // Replay/ordering guard. Assumes ONE sender per direction over a single
    // MessagePort — which is the current architecture (host↔iframe). If we
    // ever multiplex multiple senders onto one port (e.g. multiple iframes
    // posting to one host channel, or per-feature streams), this becomes a
    // dropped-message bug: a slower stream's seq=3 looks like a replay
    // after a faster stream's seq=5 already landed. Track lastInSeq per
    // (sender, stream) tuple if that day comes.
    if (env.seq <= this.lastInSeq) return // replay
    this.lastInSeq = env.seq
    const set = this.handlers.get(env.type as MessageType)
    if (!set) return
    for (const h of set) {
      try {
        h(env.payload, env)
      } catch (err) {
        if (DEBUG) console.warn('[md-reader] handler threw for', env.type, err)
      }
    }
  }
}

/**
 * Snapshot the JL CSS vars we forward to the iframe. Called on activate,
 * on theme change, and on body class mutation.
 */
export const FORWARDED_JP_VARS = [
  '--jp-layout-color0',
  '--jp-layout-color1',
  '--jp-layout-color2',
  '--jp-layout-color3',
  '--jp-content-font-family',
  '--jp-content-font-size1',
  '--jp-content-line-height',
  '--jp-ui-font-family',
  '--jp-ui-font-size1',
  '--jp-content-font-color0',
  '--jp-content-font-color1',
  '--jp-content-font-color2',
  '--jp-border-color0',
  '--jp-border-color1',
  '--jp-border-color2',
  '--jp-brand-color0',
  '--jp-brand-color1',
  '--jp-accent-color1',
  '--jp-success-color1',
  '--jp-warn-color1',
  '--jp-error-color1',
  '--jp-code-font-family',
  '--jp-code-font-size',
  '--jp-cell-editor-background',
] as const

export function snapshotTheme(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const k of FORWARDED_JP_VARS) {
    const v = cs.getPropertyValue(k).trim()
    if (v) out[k] = v
  }
  return out
}

export function detectDarkFromVars(vars: Record<string, string>): boolean {
  const layout0 = vars['--jp-layout-color0'] || ''
  // Try to parse rgb-ish color → luminance check.
  const m = layout0.match(/(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/)
  if (m) {
    const r = +m[1]
    const g = +m[2]
    const b = +m[3]
    return r + g + b < 384
  }
  if (layout0.startsWith('#')) {
    const hex = layout0.slice(1)
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
    if (full.length >= 6) {
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      if (![r, g, b].some(Number.isNaN)) return r + g + b < 384
    }
  }
  // Fallback: body class.
  if (typeof document !== 'undefined' && document.body) {
    return document.body.classList.contains('jp-mod-dark')
  }
  return false
}

export type { AnyMessage }
