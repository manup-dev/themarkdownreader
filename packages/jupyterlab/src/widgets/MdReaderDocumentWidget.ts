// MdReaderDocumentWidget wires JL's DocumentRegistry context to the
// iframe panel via a MessageBridge. It is the public-facing widget tracked
// by `IMdReaderTracker` and restorable across reloads via ILayoutRestorer.

import { DocumentWidget } from '@jupyterlab/docregistry'
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import type { ITranslator } from '@jupyterlab/translation'
import { Token } from '@lumino/coreutils'
import { DisposableSet, type IDisposable } from '@lumino/disposable'
import type { WidgetTracker } from '@jupyterlab/apputils'
import { mdReaderIcon } from '../icons'
import { MdReaderPanel } from './MdReaderPanel'

const DEBUG =
  typeof globalThis !== 'undefined' &&
  (globalThis as Record<string, unknown>).MDR_DEBUG === true

/** Cheap docId hash for v0.2. sha1 isn't worth a dep here; bump to crypto.subtle when collab lands. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // 32-bit unsigned hex
  return (h >>> 0).toString(16).padStart(8, '0')
}

export class MdReaderDocumentWidget extends DocumentWidget<
  MdReaderPanel,
  DocumentRegistry.IModel
> {
  private _cleanup = new DisposableSet()
  // Coalesce SET_MARKDOWN: `contentChanged` fires per-keystroke when the
  // same `.md` is open in another tab as an editor. Without coalescing,
  // a 200KB doc + active edit pumps 200KB across postMessage every frame.
  private _pendingRaf: number | null = null
  private _lastPushedHash = ''

  constructor(
    options: DocumentWidget.IOptions<MdReaderPanel, DocumentRegistry.IModel> & {
      translator?: ITranslator
    },
  ) {
    super(options)
    // We accept `translator` to remain forward-compatible with v0.2.1
    // string updates, but currently don't use it inside this class —
    // user-visible strings live in the companion panel + commands.
    void options.translator
    // IMPORTANT: do NOT touch `title.label` here — `DocumentWidget` wires
    // up an `_onTitleChanged` slot that treats label changes as user-driven
    // renames and POSTs to the contents API. We only set the icon (read-only
    // visual) and use the CSS class to scope theming.
    this.title.icon = mdReaderIcon
    this.addClass('mdr-document-widget')

    // Wire context → panel.
    this.context.ready.then(() => {
      if (this.isDisposed) return
      // Initial push: bypass the debounce/dedupe path so the iframe sees
      // the doc as quickly as possible.
      this.pushMarkdown()
    })

    const onContentChanged = (): void => this.schedulePush()
    const onFileChanged = (): void => this.pushMarkdown()
    this.context.model.contentChanged.connect(onContentChanged)
    this.context.fileChanged.connect(onFileChanged)

    this._cleanup.add({
      dispose: () => {
        if (this._pendingRaf !== null) {
          try { cancelAnimationFrame(this._pendingRaf) } catch { /* ignore */ }
          this._pendingRaf = null
        }
        try {
          this.context.model.contentChanged.disconnect(onContentChanged)
        } catch {
          // ignore
        }
        try {
          this.context.fileChanged.disconnect(onFileChanged)
        } catch {
          // ignore
        }
      },
    } as IDisposable)
  }

  /**
   * Coalesce a contentChanged burst into a single SET_MARKDOWN per frame.
   * Skips the push if the content hash matches the last one we sent — the
   * common case where contentChanged fires without an actual mutation
   * (cursor moves, selection changes in some plugins).
   */
  private schedulePush(): void {
    if (this._pendingRaf !== null) return
    this._pendingRaf = requestAnimationFrame(() => {
      this._pendingRaf = null
      if (this.isDisposed) return
      this.pushMarkdown()
    })
  }

  /** Forward the current document state to the iframe app. */
  pushMarkdown(): void {
    const model = this.context.model
    if (!model) return
    let markdown = ''
    try {
      markdown = model.toString()
    } catch (err) {
      if (DEBUG) console.warn('[md-reader/jupyterlab] toString failed', err)
      return
    }
    const path = this.context.path
    // Dedup on hash so unchanged content never crosses the bridge.
    // fnv1a is plenty for change-detection — collision rate is irrelevant
    // here, we just want a cheap "did the body actually move?" signal.
    const hash = fnv1a(markdown) + ':' + markdown.length.toString(36)
    if (hash === this._lastPushedHash) return
    this._lastPushedHash = hash
    this.content.setMarkdown({
      docId: fnv1a(path),
      path,
      markdown,
      mtime: Date.now(),
      readOnly: model.readOnly === true,
    })
  }

  dispose(): void {
    if (this.isDisposed) return
    this._cleanup.dispose()
    super.dispose()
  }
}

/**
 * Token for the md-reader widget tracker. Other plugins can `requires` this
 * to send commands to the active reader (e.g., the companion panel).
 */
export const IMdReaderTracker = new Token<WidgetTracker<MdReaderDocumentWidget>>(
  '@md-reader/jupyterlab:IMdReaderTracker',
)
