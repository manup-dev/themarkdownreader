// CompanionPanel is a JL-native React widget that lives in the `'right'`
// shell area. It has two tabs: an Outline (parses headings from the
// current document) and a Chat stub (full AI in v0.2.1).
//
// Headings come from a fast regex extractor — markdown is small enough at
// the scales we care about that a real parser is overkill. The extractor
// trims fenced/inline code spans so a `# foo` inside ``` doesn't get
// mis-counted.

import * as React from 'react'
import { ReactWidget } from '@jupyterlab/ui-components'
import { Signal, type ISignal } from '@lumino/signaling'
import type { ITranslator } from '@jupyterlab/translation'
import { mdReaderIcon } from '../icons'
import type { MdReaderDocumentWidget } from './MdReaderDocumentWidget'

export interface OutlineHeading {
  id: string
  text: string
  level: number
}

/**
 * Slugify a heading text the same way the iframe's `extractToc` does, so the
 * anchors the companion emits match the DOM IDs the iframe produces. The
 * previous regex (`[^\w\s-]`) stripped any non-ASCII letter, which silently
 * broke jump-to for headings like "## ✨ Quick Start" (companion would emit
 * `quick-start`, iframe DOM ID was `-quick-start`).
 *
 * Kept inline here (rather than imported from the iframe's source) so this
 * package stays free of a JS-side cross-package dependency. If the iframe's
 * slugify ever changes, search for "SLUG SYNC" in both repos and update.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')                       // SLUG SYNC: decompose accents (é → e + combining accent)
    .replace(/[̀-ͯ]/g, '')        // SLUG SYNC: strip combining diacritical marks
    .replace(/[^\p{L}\p{N}\s-]/gu, '')      // SLUG SYNC: keep letters (any script), numbers, spaces, hyphens
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/** Extract ATX headings from markdown. Trims fenced code blocks first. */
export function extractHeadings(md: string): OutlineHeading[] {
  if (!md) return []
  // strip fenced blocks (``` and ~~~)
  const stripped = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
  const out: OutlineHeading[] = []
  const re = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(stripped))) {
    const level = m[1].length
    const text = m[2].replace(/`([^`]+)`/g, '$1').trim()
    let id = slugify(text)
    if (!id) continue
    let n = 1
    while (seen.has(id)) id = `${slugify(text)}-${n++}`
    seen.add(id)
    out.push({ id, text, level })
  }
  return out
}

interface CompanionState {
  activeTab: 'outline' | 'chat'
  doc: MdReaderDocumentWidget | null
  outline: OutlineHeading[]
}

function CompanionView(props: {
  signal: ISignal<unknown, CompanionState>
  getState: () => CompanionState
  onJumpTo: (anchor: string) => void
  trans?: ReturnType<ITranslator['load']> | null
}) {
  // Lazy initializer — captures the latest state when React first renders.
  // Subsequent updates flow through the signal.
  const [state, setState] = React.useState<CompanionState>(() => props.getState())
  React.useEffect(() => {
    // Resync once on mount in case the active doc changed during the
    // microtask between widget creation and React commit.
    setState(props.getState())
    const slot = (_sender: unknown, s: CompanionState) => setState(s)
    props.signal.connect(slot)
    return () => {
      props.signal.disconnect(slot)
    }
  }, [props.signal])

  const t = (en: string) => (props.trans ? props.trans.__(en) : en)

  return (
    <div className="mdr-companion">
      <div className="mdr-companion-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={state.activeTab === 'outline'}
          className={`mdr-companion-tab ${state.activeTab === 'outline' ? 'is-active' : ''}`}
          onClick={() => setState(s => ({ ...s, activeTab: 'outline' }))}
        >
          {t('Outline')}
        </button>
        <button
          role="tab"
          aria-selected={state.activeTab === 'chat'}
          className={`mdr-companion-tab ${state.activeTab === 'chat' ? 'is-active' : ''}`}
          onClick={() => setState(s => ({ ...s, activeTab: 'chat' }))}
        >
          {t('Chat')}
        </button>
      </div>
      <div className="mdr-companion-body">
        {state.activeTab === 'outline' ? (
          state.doc ? (
            state.outline.length === 0 ? (
              <p className="mdr-companion-empty">{t('No headings in this document.')}</p>
            ) : (
              <ul className="mdr-outline">
                {state.outline.map(h => (
                  <li
                    key={h.id}
                    className={`mdr-outline-item lvl-${h.level}`}
                    onClick={() => props.onJumpTo(h.id)}
                  >
                    <span className="mdr-outline-text">{h.text}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="mdr-companion-empty">
              {t('Open a markdown file with the Markdown Reader to see its outline.')}
            </p>
          )
        ) : (
          <div className="mdr-chat-stub">
            <p>{t('AI chat is coming in v0.2.1.')}</p>
            <p className="mdr-companion-hint">
              {t(
                'For now, open the Markdown Reader and use its built-in AI features (Chat, Coach, Q&A) directly inside the document view.',
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export class MdReaderCompanionPanel extends ReactWidget {
  private _changed = new Signal<this, CompanionState>(this)
  private _state: CompanionState = {
    activeTab: 'outline',
    doc: null,
    outline: [],
  }
  private _trans: ReturnType<ITranslator['load']> | null = null
  private _docSlot: ((sender: unknown, h: OutlineHeading[]) => void) | null = null
  private _onContentSlot: {
    signal: ISignal<unknown, void>
    slot: () => void
  } | null = null

  constructor(translator?: ITranslator) {
    super()
    this.id = 'md-reader-companion'
    this.title.icon = mdReaderIcon
    this.title.caption = 'Markdown Reader companion'
    this.addClass('mdr-companion-widget')
    if (translator) {
      this._trans = translator.load('jupyterlab-md-reader')
    }
    this.title.label = this._trans ? this._trans.__('Reader') : 'Reader'
  }

  setActiveDoc(doc: MdReaderDocumentWidget | null): void {
    // Detach old outline-signal slot.
    if (this._state.doc && this._docSlot) {
      try {
        this._state.doc.content.outlineChanged.disconnect(this._docSlot as never)
      } catch {
        // ignore
      }
    }
    this._docSlot = null
    // Detach old content-changed slot. Without this, every doc switch piles
    // another listener onto the previous doc's model — opening N markdown
    // files leaks N closures (reviewer-flagged memory leak).
    if (this._onContentSlot) {
      try {
        this._onContentSlot.signal.disconnect(this._onContentSlot.slot as never)
      } catch {
        // ignore
      }
      this._onContentSlot = null
    }
    if (doc) {
      const slot = (_sender: unknown, headings: OutlineHeading[]): void => {
        this._state = { ...this._state, outline: headings, doc }
        this._changed.emit(this._state)
      }
      this._docSlot = slot
      try {
        doc.content.outlineChanged.connect(slot as never)
      } catch {
        // ignore
      }
      // Seed initial outline from markdown if we have any (iframe may not
      // have responded yet). We also re-extract once the context becomes
      // ready, since on a freshly-restored widget the model may be empty
      // at the moment we are wired up.
      const md = (() => {
        try {
          return doc.context.model.toString()
        } catch {
          return ''
        }
      })()
      const headings = doc.content.outline.length
        ? doc.content.outline
        : extractHeadings(md)
      this._state = { ...this._state, doc, outline: headings }
      void doc.context.ready.then(() => {
        if (this.isDisposed) return
        if (this._state.doc !== doc) return
        if (this._state.outline.length > 0) return
        try {
          const fresh = extractHeadings(doc.context.model.toString())
          if (fresh.length > 0) {
            this._state = { ...this._state, outline: fresh }
            this._changed.emit(this._state)
          }
        } catch {
          // ignore
        }
      })
      // Also re-extract on contentChanged so renames + edits update.
      const onContent = (): void => {
        if (this._state.doc !== doc) return
        try {
          const fresh = extractHeadings(doc.context.model.toString())
          this._state = { ...this._state, outline: fresh }
          this._changed.emit(this._state)
        } catch {
          // ignore
        }
      }
      doc.context.model.contentChanged.connect(onContent)
      this._onContentSlot = {
        signal: doc.context.model.contentChanged as unknown as ISignal<
          unknown,
          void
        >,
        slot: onContent,
      }
    } else {
      this._state = { ...this._state, doc: null, outline: [] }
    }
    this._changed.emit(this._state)
  }

  protected render(): React.JSX.Element {
    return (
      <CompanionView
        signal={this._changed}
        getState={() => this._state}
        trans={this._trans}
        onJumpTo={anchor => {
          this._state.doc?.content.scrollTo(anchor)
        }}
      />
    )
  }

  dispose(): void {
    if (this.isDisposed) return
    // Detach any active content-changed slot from the doc model before
    // tearing down. The model outlives the panel (it's owned by the
    // DocumentRegistry context), so leaving a dangling slot would leak
    // both the closure and a reference back to this panel.
    if (this._onContentSlot) {
      try {
        this._onContentSlot.signal.disconnect(this._onContentSlot.slot as never)
      } catch {
        // ignore
      }
      this._onContentSlot = null
    }
    if (this._state.doc && this._docSlot) {
      try {
        this._state.doc.content.outlineChanged.disconnect(
          this._docSlot as never,
        )
      } catch {
        // ignore
      }
      this._docSlot = null
    }
    Signal.clearData(this)
    super.dispose()
  }
}
