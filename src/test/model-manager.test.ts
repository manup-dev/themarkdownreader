/**
 * Unit tests for model-manager.ts
 *
 * gemma-engine is fully mocked so no real model is loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock state (available to vi.mock factory) ────────────────────────

type ProgressCallback = (progress: { status: string; percent?: number; message?: string }) => void

const hoisted = vi.hoisted(() => {
  const progressListeners: Set<ProgressCallback> = new Set()

  const mockLoadGemmaModel = vi.fn().mockResolvedValue(undefined)
  const mockGetGemmaStatus = vi.fn().mockReturnValue('idle')
  const mockOnGemmaProgress = vi.fn((cb: ProgressCallback) => {
    progressListeners.add(cb)
    return () => progressListeners.delete(cb)
  })

  return { progressListeners, mockLoadGemmaModel, mockGetGemmaStatus, mockOnGemmaProgress }
})

// ─── Mock gemma-engine ────────────────────────────────────────────────────────

vi.mock('../lib/inference/gemma-engine', () => ({
  loadGemmaModel: hoisted.mockLoadGemmaModel,
  getGemmaStatus: hoisted.mockGetGemmaStatus,
  onGemmaProgress: hoisted.mockOnGemmaProgress,
}))

// ─── Destructure for convenience ──────────────────────────────────────────────

const { progressListeners, mockLoadGemmaModel, mockGetGemmaStatus, mockOnGemmaProgress } = hoisted

// ─── Helper to emit progress events ──────────────────────────────────────────

function emitProgress(payload: { status: string; percent?: number; message?: string }) {
  for (const cb of progressListeners) {
    cb(payload)
  }
}

// ─── Import after mock ────────────────────────────────────────────────────────

import {
  getModelState,
  onModelProgress,
  waitForReady,
  preloadGemma,
  resetModelManager,
} from '../lib/inference/model-manager'

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  progressListeners.clear()
  vi.clearAllMocks()
  mockLoadGemmaModel.mockResolvedValue(undefined)
  mockGetGemmaStatus.mockReturnValue('idle')
  mockOnGemmaProgress.mockImplementation((cb: ProgressCallback) => {
    progressListeners.add(cb)
    return () => progressListeners.delete(cb)
  })
  resetModelManager()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('model-manager exports', () => {
  it('exports getModelState as a function', () => {
    expect(typeof getModelState).toBe('function')
  })

  it('exports onModelProgress as a function', () => {
    expect(typeof onModelProgress).toBe('function')
  })

  it('exports waitForReady as a function', () => {
    expect(typeof waitForReady).toBe('function')
  })

  it('exports preloadGemma as a function', () => {
    expect(typeof preloadGemma).toBe('function')
  })

  it('exports resetModelManager as a function', () => {
    expect(typeof resetModelManager).toBe('function')
  })
})

describe('getModelState initial state', () => {
  it('returns idle status with progress 0 and empty progressText', () => {
    expect(getModelState()).toEqual({
      status: 'idle',
      progress: 0,
      progressText: '',
    })
  })
})

describe('onModelProgress', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onModelProgress(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('notifies subscriber when state changes via emitted progress', () => {
    const received: string[] = []
    onModelProgress((s) => received.push(s.status))

    preloadGemma()
    emitProgress({ status: 'loading', percent: 20, message: 'Loading…' })

    expect(received).toContain('downloading')
  })

  it('does not notify after unsubscribe', () => {
    const received: string[] = []
    const unsub = onModelProgress((s) => received.push(s.status))
    unsub()

    preloadGemma()
    emitProgress({ status: 'loading', percent: 50, message: 'Loading…' })

    expect(received).toHaveLength(0)
  })
})

describe('progress bridging from gemma-engine', () => {
  it('maps loading + percent to downloading state', () => {
    preloadGemma()
    emitProgress({ status: 'loading', percent: 40, message: 'Loading ONNX…' })

    const s = getModelState()
    expect(s.status).toBe('downloading')
    expect(s.progress).toBeCloseTo(0.4)
    expect(s.progressText).toBe('Loading ONNX…')
  })

  it('maps ready to ready state with progress 1', () => {
    preloadGemma()
    emitProgress({ status: 'ready', percent: 100, message: 'Model ready' })

    const s = getModelState()
    expect(s.status).toBe('ready')
    expect(s.progress).toBe(1)
  })

  it('maps failed to failed state with progress 0', async () => {
    preloadGemma()

    // redetectBackend() runs async before setState — wait for the state change
    const waitForFailed = new Promise<void>((resolve) => {
      const unsub = onModelProgress((s) => {
        if (s.status === 'failed') { unsub(); resolve() }
      })
    })

    emitProgress({ status: 'failed', message: 'OOM' })
    await waitForFailed

    const s = getModelState()
    expect(s.status).toBe('failed')
    expect(s.progress).toBe(0)
  })
})

describe('waitForReady', () => {
  it('resolves immediately when already ready', async () => {
    preloadGemma()
    emitProgress({ status: 'ready' })

    await expect(waitForReady()).resolves.toBeUndefined()
  })

  it('rejects immediately when already failed', async () => {
    preloadGemma()
    emitProgress({ status: 'failed', message: 'Error' })

    await expect(waitForReady()).rejects.toThrow()
  })

  it('resolves when ready event is emitted after subscription', async () => {
    preloadGemma()

    const promise = waitForReady()
    emitProgress({ status: 'ready' })

    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects when failed event is emitted after subscription', async () => {
    preloadGemma()

    const promise = waitForReady()
    emitProgress({ status: 'failed', message: 'Error' })

    await expect(promise).rejects.toThrow()
  })
})

describe('preloadGemma', () => {
  it('is idempotent — does not register multiple progress listeners on repeat calls', () => {
    preloadGemma()
    preloadGemma()
    preloadGemma()

    // Only one registration of onGemmaProgress should happen
    expect(mockOnGemmaProgress).toHaveBeenCalledTimes(1)
  })

  it('resolves instantly when gemma engine already reports ready', () => {
    mockGetGemmaStatus.mockReturnValue('ready')
    preloadGemma()

    expect(getModelState().status).toBe('ready')
    expect(getModelState().progress).toBe(1)
  })
})

describe('resetModelManager', () => {
  it('resets state to idle after receiving ready', () => {
    preloadGemma()
    emitProgress({ status: 'ready' })
    expect(getModelState().status).toBe('ready')

    resetModelManager()
    expect(getModelState()).toEqual({ status: 'idle', progress: 0, progressText: '' })
  })

  it('allows preloadGemma to be called again after reset', () => {
    preloadGemma()
    resetModelManager()
    preloadGemma()

    // After reset + second preload, a new listener was registered
    expect(mockOnGemmaProgress).toHaveBeenCalledTimes(2)
  })
})
