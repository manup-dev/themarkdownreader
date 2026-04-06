/**
 * Model lifecycle manager for Gemma 4 E2B.
 *
 * Handles background preload scheduling, status tracking, and progress
 * reporting. Bridges gemma-engine's GemmaStatus into the ModelState format
 * that UI components and ai.ts can subscribe to.
 */

import { loadGemmaModel, getGemmaStatus, onGemmaProgress } from './gemma-engine'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelState {
  status: 'idle' | 'downloading' | 'ready' | 'failed'
  progress: number       // 0-1
  progressText: string
}

// ─── Internal state ───────────────────────────────────────────────────────────

let state: ModelState = { status: 'idle', progress: 0, progressText: '' }
let preloadScheduled = false
let readyResolvers: Array<() => void> = []
let readyRejectors: Array<(err: Error) => void> = []

const listeners: Set<(state: ModelState) => void> = new Set()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setState(next: ModelState): void {
  state = next
  for (const cb of listeners) {
    try { cb(state) } catch { /* ignore */ }
  }

  if (next.status === 'ready') {
    for (const resolve of readyResolvers) resolve()
    readyResolvers = []
    readyRejectors = []
  }

  if (next.status === 'failed') {
    const err = new Error('Gemma model failed to load')
    for (const reject of readyRejectors) reject(err)
    readyResolvers = []
    readyRejectors = []
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return the current model state snapshot. */
export function getModelState(): ModelState {
  return state
}

/**
 * Subscribe to model state changes.
 * Returns an unsubscribe function.
 */
export function onModelProgress(cb: (state: ModelState) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Resolves when the model is ready.
 * Rejects if the model fails to load.
 */
export function waitForReady(): Promise<void> {
  if (state.status === 'ready') return Promise.resolve()
  if (state.status === 'failed') return Promise.reject(new Error('Gemma model failed to load'))

  return new Promise<void>((resolve, reject) => {
    readyResolvers.push(resolve)
    readyRejectors.push(reject)
  })
}

/**
 * Schedules a background preload of the Gemma model after first paint.
 * Safe to call multiple times — idempotent (unless previous attempt failed).
 */
export function preloadGemma(): void {
  // Allow retry after failure
  if (preloadScheduled && state.status !== 'failed') return
  preloadScheduled = true

  // Wire up progress bridging from gemma-engine → ModelState
  onGemmaProgress((p) => {
    if (p.status === 'loading') {
      setState({
        status: 'downloading',
        progress: p.percent != null ? p.percent / 100 : state.progress,
        progressText: p.message ?? '',
      })
    } else if (p.status === 'ready') {
      setState({ status: 'ready', progress: 1, progressText: p.message ?? 'Model ready' })
    } else if (p.status === 'failed') {
      // Re-detect backend so fallbacks (Ollama, OpenRouter) are found
      // Dynamic import avoids circular dependency (model-manager ↔ ai)
      import('../ai').then(ai => ai.redetectBackend()).finally(() => {
        setState({ status: 'failed', progress: 0, progressText: p.message ?? 'Load failed' })
      })
    }
    // 'idle' events (e.g. unload) are ignored here — resetModelManager handles those
  })

  // If already cached/ready, resolve instantly without scheduling
  if (getGemmaStatus() === 'ready') {
    setState({ status: 'ready', progress: 1, progressText: 'Model ready' })
    return
  }

  // Schedule load after first paint using requestIdleCallback or setTimeout fallback
  const doLoad = () => {
    loadGemmaModel().catch(() => {
      // setState is already handled by the onGemmaProgress listener
    })
  }

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(doLoad, { timeout: 5000 })
  } else {
    setTimeout(doLoad, 2000)
  }
}

/**
 * Reset all internal state. Intended for testing or manual retry flows.
 */
export function resetModelManager(): void {
  state = { status: 'idle', progress: 0, progressText: '' }
  preloadScheduled = false
  readyResolvers = []
  readyRejectors = []
  listeners.clear()
}
