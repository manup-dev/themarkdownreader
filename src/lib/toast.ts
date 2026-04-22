/**
 * Tiny toast helper — matches the existing `.toast-notify` DOM-append
 * pattern used by Reader / Toolbar / SelectionMenu so all share-surface
 * toasts have a single implementation.
 *
 * Kept dependency-free (no React, no state) because toasts fire from
 * async callbacks and event handlers that already live outside the
 * component render cycle; dragging a context/provider in for this would
 * be heavier than the 20 lines below.
 */

export interface ToastOptions {
  /** How long the toast stays visible (ms). Defaults to 2000. */
  durationMs?: number
  /** Optional action button label. When set, an "Undo"-style button
   *  appears next to the message; clicking it calls `onAction`. */
  actionLabel?: string
  onAction?: () => void
}

export function showToast(message: string, opts: ToastOptions = {}): void {
  if (typeof document === 'undefined') return
  const toast = document.createElement('div')
  toast.className = 'toast-notify'

  if (opts.actionLabel && opts.onAction) {
    // Two-child layout: message + action button. Inline styles keep us
    // independent of Tailwind availability when this fires very early.
    toast.style.display = 'inline-flex'
    toast.style.alignItems = 'center'
    toast.style.gap = '12px'

    const msg = document.createElement('span')
    msg.textContent = message
    toast.appendChild(msg)

    const btn = document.createElement('button')
    btn.textContent = opts.actionLabel
    btn.style.color = 'inherit'
    btn.style.textDecoration = 'underline'
    btn.style.fontWeight = '600'
    btn.style.cursor = 'pointer'
    btn.style.background = 'transparent'
    btn.style.border = 'none'
    btn.style.padding = '0'
    btn.style.fontSize = 'inherit'
    btn.addEventListener('click', () => {
      try { opts.onAction?.() } finally { toast.remove() }
    })
    toast.appendChild(btn)
  } else {
    toast.textContent = message
  }

  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), opts.durationMs ?? 2000)
}
