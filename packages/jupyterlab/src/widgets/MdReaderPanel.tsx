// MdReaderPanel owns the iframe that hosts the md-reader app. It is the
// `content` of an `MdReaderDocumentWidget`, wrapped in JupyterLab's
// DocumentWidget so it integrates with the standard document title +
// dirty indicator + lifecycle.
//
// The widget exposes typed setter methods that route through a
// `MessageBridge` over a transferred MessagePort.

import { Widget } from '@lumino/widgets'
import { Signal, type ISignal } from '@lumino/signaling'
import { PageConfig, URLExt } from '@jupyterlab/coreutils'
import {
  MessageBridge,
  snapshotTheme,
  detectDarkFromVars,
  type ProtocolError,
} from '../bridge/MessageBridge'
import type {
  SetMarkdown,
  SetTheme,
  SetSettings,
  ScrollTo,
  SetLocale,
} from '../protocol/messages'

/** Static path under the labextension where the iframe app is served. */
const APP_BASE_PATH = '@md-reader/jupyterlab/static/app/'

export interface MdReaderPanelOptions {
  hostVersion: string
  sessionId: string
  userId: string
  /** Optional iframe cache-buster (build hash from manifest.json). */
  appBuild?: string
}

interface OutlineHeading {
  id: string
  text: string
  level: number
}

export class MdReaderPanel extends Widget {
  private iframe: HTMLIFrameElement
  private bridge: MessageBridge
  private _outlineChanged = new Signal<this, OutlineHeading[]>(this)
  private _outline: OutlineHeading[] = []
  private _docId: string | null = null

  // Last-known state — replayed once the bridge becomes ready so we don't
  // race the iframe's load lifecycle.
  private pendingMarkdown: SetMarkdown['payload'] | null = null
  private pendingTheme: SetTheme['payload'] | null = null
  private pendingSettings: SetSettings['payload'] | null = null
  private pendingLocale: SetLocale['payload'] | null = null

  constructor(options: MdReaderPanelOptions) {
    super()
    this.addClass('mdr-panel')
    this.node.style.height = '100%'
    this.node.style.minHeight = '0'
    this.node.style.display = 'flex'

    // Build the iframe src against PageConfig.getBaseUrl so JupyterHub
    // /user/... prefixes work. Append the extension's package version as a
    // cache-buster so users on `pip install --upgrade` don't pick up an
    // index.html that still references the previous build's hashed chunks.
    // Append a per-panel handshake nonce (echoed back by the iframe in its
    // READY payload) — the bridge refuses to open the channel without it,
    // which stops a same-origin attacker from posting a hand-crafted READY.
    const baseUrl = PageConfig.getBaseUrl()
    const cacheBust = options.appBuild || options.hostVersion
    const handshake = mintHandshakeNonce()
    const src =
      URLExt.join(baseUrl, 'lab', 'extensions', APP_BASE_PATH, 'index.html') +
      `?v=${encodeURIComponent(cacheBust)}&h=${encodeURIComponent(handshake)}`

    this.iframe = document.createElement('iframe')
    this.iframe.setAttribute('title', 'md-reader')
    // NOTE: `allow-same-origin` plus `allow-scripts` together is effectively
    // *no sandbox* — the HTML spec treats this combo as equivalent to omitting
    // the attribute entirely when the iframe shares the parent's origin. We
    // keep both for now because the iframe app needs IndexedDB/localStorage
    // (both of which are gated on a non-null origin). v0.3's native reading
    // surface drops the iframe entirely and removes this caveat. Until then,
    // *do not* assume the sandbox attribute is providing isolation — defense
    // lives in the postMessage handshake and origin pinning.
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    this.iframe.setAttribute('referrerpolicy', 'no-referrer')
    this.iframe.style.flex = '1 1 auto'
    this.iframe.style.border = '0'
    this.iframe.style.width = '100%'
    this.iframe.style.height = '100%'
    this.iframe.src = src
    this.node.appendChild(this.iframe)

    this.bridge = new MessageBridge()
    this.bridge.attach(
      this.iframe,
      window.location.origin,
      {
        host: { name: 'jupyterlab', version: options.hostVersion },
        capabilities: ['persistence', 'commands', 'shortcuts'],
        session: { sessionId: options.sessionId, userId: options.userId },
      },
      handshake,
    )

    this.bridge.onReady(() => this.replayPending())

    this.bridge.on<{ docId: string; headings: OutlineHeading[] }>(
      'OUTLINE',
      payload => {
        if (this._docId && payload.docId !== this._docId) return
        this._outline = payload.headings || []
        this._outlineChanged.emit(this._outline)
      },
    )
  }

  /** Outline emitted by the iframe app. */
  get outlineChanged(): ISignal<this, OutlineHeading[]> {
    return this._outlineChanged
  }

  get outline(): OutlineHeading[] {
    return this._outline
  }

  get docId(): string | null {
    return this._docId
  }

  setMarkdown(payload: SetMarkdown['payload']): void {
    this._docId = payload.docId
    this.pendingMarkdown = payload
    if (this.bridge.isReady()) {
      this.bridge.send('SET_MARKDOWN', payload)
    }
  }

  setTheme(payload?: SetTheme['payload']): void {
    const next =
      payload ??
      (() => {
        const vars = snapshotTheme()
        const dark = detectDarkFromVars(vars)
        return {
          dark,
          fontFamily: vars['--jp-content-font-family'] || '',
          fontSize: parseFloat(vars['--jp-content-font-size1'] || '14') || 14,
          jpVars: vars,
          highContrast: false,
        }
      })()
    this.pendingTheme = next
    if (this.bridge.isReady()) {
      this.bridge.send('SET_THEME', next)
    }
  }

  setSettings(payload: SetSettings['payload']): void {
    this.pendingSettings = payload
    if (this.bridge.isReady()) {
      this.bridge.send('SET_SETTINGS', payload)
    }
  }

  /**
   * Forward the JL ITranslator language code to the iframe. The web app
   * currently only persists this for v0.2.1 wiring — md-reader's own i18n
   * is out of scope for v0.2.
   */
  setLocale(payload: SetLocale['payload']): void {
    this.pendingLocale = payload
    if (this.bridge.isReady()) {
      this.bridge.send('SET_LOCALE', payload)
    }
  }

  scrollTo(anchor: string): void {
    if (this.bridge.isReady()) {
      this.bridge.send<ScrollTo['payload']>('SCROLL_TO', { anchor })
    }
  }

  dispose(): void {
    if (this.isDisposed) return
    // CRITICAL: cut the iframe loose first so any pending teardown in the
    // child doesn't try to message us after we've disposed the bridge.
    try {
      this.iframe.src = 'about:blank'
    } catch {
      // ignore
    }
    Signal.clearData(this)
    try {
      this.bridge.dispose()
    } catch {
      // ignore
    }
    super.dispose()
  }

  /**
   * Subscribe to protocol-level errors from this panel's bridge. Plugin code
   * uses this to drive the status-bar indicator and surface a JL notification.
   */
  onError(handler: (e: ProtocolError) => void): () => void {
    return this.bridge.onError(handler)
  }

  private replayPending(): void {
    if (this.pendingTheme) this.bridge.send('SET_THEME', this.pendingTheme)
    if (this.pendingSettings) this.bridge.send('SET_SETTINGS', this.pendingSettings)
    if (this.pendingLocale) this.bridge.send('SET_LOCALE', this.pendingLocale)
    if (this.pendingMarkdown) this.bridge.send('SET_MARKDOWN', this.pendingMarkdown)
  }
}

/**
 * Generate a cryptographically random handshake nonce. Prefers
 * `crypto.randomUUID()` (RFC 9562 v4 UUID, ~122 bits of entropy); falls
 * back to `crypto.getRandomValues()` over a 16-byte buffer hex-encoded.
 * Fails closed if neither CSPRNG is available — the handshake nonce IS
 * the security gate that prevents a same-origin attacker from spoofing
 * READY, so a non-CSPRNG (Math.random) fallback is not acceptable here.
 *
 * `crypto.randomUUID` requires a Secure Context. JupyterLab is normally
 * served over http://localhost or https://, both of which qualify; if a
 * deployment somehow serves Lab over plain http on a non-localhost host,
 * this fallback to `getRandomValues` (which has no Secure Context
 * requirement) keeps the bridge usable without weakening the nonce.
 */
function mintHandshakeNonce(): string {
  if (typeof crypto === 'undefined') {
    throw new Error(
      'md-reader: Web Crypto API unavailable — cannot mint handshake nonce. ' +
        'JupyterLab must be served over http://localhost or https://.',
    )
  }
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Secure Context check failed on randomUUID — fall through to
    // getRandomValues, which has no Secure Context requirement.
  }
  if (typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    let hex = ''
    for (let i = 0; i < buf.length; i++) {
      hex += buf[i].toString(16).padStart(2, '0')
    }
    return hex
  }
  throw new Error(
    'md-reader: no Web Crypto RNG available — cannot mint handshake nonce.',
  )
}
