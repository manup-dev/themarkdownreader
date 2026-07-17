import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadKokoro, unloadKokoro } from '../lib/kokoro-tts'

// Silent fake worker: records constructions, never answers the init
// message, so the load stays pending and no model is ever downloaded.
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor() { FakeWorker.instances.push(this) }
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

afterEach(async () => {
  await unloadKokoro()
  vi.unstubAllGlobals()
  FakeWorker.instances.length = 0
})

describe('loadKokoro (A8 — concurrent calls while the GPU lock is held)', () => {
  it('creates exactly ONE worker for two concurrent loads racing the GPU lock', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const w = window as unknown as { __gpuModelLock?: string }
    w.__gpuModelLock = 'gemma' // Gemma is "loading" — both callers must wait

    const p1 = loadKokoro()
    const p2 = loadKokoro()
    p1.catch(() => {}) // load never completes (FakeWorker) — silence rejections
    p2.catch(() => {})

    await new Promise((r) => setTimeout(r, 50)) // both callers now polling the lock
    w.__gpuModelLock = undefined                // Gemma releases the GPU

    // Give both pollers time to wake (200ms poll interval) and reach _load.
    await new Promise((r) => setTimeout(r, 700))

    expect(FakeWorker.instances.length).toBe(1)
  })
})
