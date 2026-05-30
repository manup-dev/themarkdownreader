// React-based status-bar item — replaces the hand-crafted DOM version that
// the Jupyter-ecosystem reviewer flagged in v0.2. Holds its own Signal so
// it can re-render when the underlying plugin status changes
// (e.g. settings toggle the AI backend off → 'disabled').

import * as React from 'react'
import { ReactWidget } from '@jupyterlab/ui-components'
import { Signal, type ISignal } from '@lumino/signaling'

export interface MdReaderStatus {
  status: 'ok' | 'disabled' | 'error'
  label: string
}

export class MdReaderStatusItem extends ReactWidget {
  private _state: MdReaderStatus
  private _changed = new Signal<this, MdReaderStatus>(this)

  constructor(initial: MdReaderStatus) {
    super()
    this._state = initial
    this.addClass('mdr-statusbar-item')
    this.addClass('jp-mod-highlighted')
  }

  setStatus(next: MdReaderStatus): void {
    this._state = next
    this._changed.emit(next)
    this.update()
  }

  get changed(): ISignal<this, MdReaderStatus> {
    return this._changed
  }

  render(): React.JSX.Element {
    const { status, label } = this._state
    const dotColor =
      status === 'ok'
        ? 'var(--jp-success-color1)'
        : status === 'error'
        ? 'var(--jp-error-color1)'
        : 'var(--jp-warn-color1)'
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0 6px',
        }}
        aria-label={`md-reader status: ${status}`}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            display: 'inline-block',
          }}
        />
        <span>{label}</span>
      </span>
    )
  }
}
