/**
 * Kokoro TTS engine — high-quality neural TTS in the browser.
 *
 * Architecture:
 *   Web Worker (off-thread synthesis) → AudioWorklet (gapless ring buffer)
 *     → BiquadFilter (voice EQ) → DynamicsCompressor (broadcast quality)
 *     → AudioContext.destination
 *
 * Falls back to main-thread synthesis if Web Worker fails.
 *
 * Voices:
 *   Alex (Host A): af_heart — American female, highest quality
 *   Sam  (Host B): am_adam  — American male
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type KokoroStatus = 'idle' | 'loading' | 'ready' | 'failed'

// ─── State ───────────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 300_000 // 5 minutes — longer than Gemma since TTS spans playback

let status: KokoroStatus = 'idle'
let loadPromise: Promise<void> | null = null
let activeDevice: 'webgpu' | 'wasm' = 'wasm'
let idleTimer: ReturnType<typeof setTimeout> | null = null

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (status === 'ready') {
      console.log('[kokoro-tts] Idle timeout — unloading to free GPU memory')
      unloadKokoro().catch(() => { /* non-fatal */ })
    }
  }, IDLE_TIMEOUT_MS)
}

// Worker-based engine
let worker: Worker | null = null
let workerReady = false
let msgId = 0

// Fallback: main-thread engine (if Worker fails)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fallbackEngine: any = null

const VOICES = {
  A: 'af_heart',   // Alex — American female, grade A
  B: 'am_adam',    // Sam — American male
} as const

type ProgressCallback = (pct: number, text: string) => void
let progressCb: ProgressCallback | null = null

// Audio pipeline
let audioCtx: AudioContext | null = null
let compressor: DynamicsCompressorNode | null = null
let highpass: BiquadFilterNode | null = null
let presence: BiquadFilterNode | null = null

// ─── WebGPU detection ────────────────────────────────────────────────────────

async function hasWebGPU(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }
    if (!nav.gpu) return false
    const adapter = await Promise.race([
      nav.gpu.requestAdapter(),
      new Promise<null>(r => setTimeout(() => r(null), 2000)),
    ])
    return adapter !== null
  } catch { return false }
}

/**
 * Attach a GPU device lost handler. On device loss (driver crash, OOM, tab
 * backgrounded too long), unload Kokoro so the next synthesis call can cleanly
 * re-initialize rather than hang or crash the tab.
 */
async function attachGpuLostHandler(): Promise<void> {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ requestDevice?: () => Promise<{ lost?: Promise<{ reason: string; message: string }> }> } | null> } }
    if (!nav.gpu) return
    const adapter = await nav.gpu.requestAdapter()
    if (!adapter?.requestDevice) return
    const device = await adapter.requestDevice()
    if (!device?.lost) return
    device.lost.then((info) => {
      console.warn('[kokoro-tts] GPU device lost:', info.reason, info.message)
      if (status === 'ready' || status === 'loading') {
        console.warn('[kokoro-tts] Unloading Kokoro due to GPU device lost')
        unloadKokoro().catch(() => { /* non-fatal */ })
      }
    }).catch(() => { /* ignore */ })
  } catch (e) {
    console.warn('[kokoro-tts] Failed to attach GPU lost handler:', e)
  }
}

// ─── Audio Processing Chain ──────────────────────────────────────────────────

function getAudioPipeline(sampleRate: number): { ctx: AudioContext; input: AudioNode } {
  if (audioCtx && audioCtx.state !== 'closed' && compressor) {
    return { ctx: audioCtx, input: highpass! }
  }

  audioCtx = new AudioContext({ sampleRate })

  // Highpass — cut rumble below 80Hz
  highpass = audioCtx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 80
  highpass.Q.value = 0.7

  // Presence boost at 3kHz for voice clarity
  presence = audioCtx.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 3000
  presence.gain.value = 3
  presence.Q.value = 1.0

  // Broadcast-quality compressor for consistent volume
  compressor = audioCtx.createDynamicsCompressor()
  compressor.threshold.value = -24   // start compressing at -24dB
  compressor.knee.value = 12         // soft knee
  compressor.ratio.value = 4         // 4:1 — standard voice compression
  compressor.attack.value = 0.003    // 3ms — fast for speech transients
  compressor.release.value = 0.15    // 150ms — smooth release

  // Chain: input → highpass → presence → compressor → speakers
  highpass.connect(presence)
  presence.connect(compressor)
  compressor.connect(audioCtx.destination)

  return { ctx: audioCtx, input: highpass }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getKokoroStatus(): KokoroStatus {
  return status
}

export function isKokoroReady(): boolean {
  return status === 'ready' && (workerReady || fallbackEngine !== null)
}

export async function loadKokoro(onProgress?: ProgressCallback): Promise<void> {
  if (status === 'ready') return
  if (loadPromise) return loadPromise

  // Wait for GPU lock to release (up to 20s) rather than failing immediately.
  // Other model (Gemma) will release the lock when it finishes loading.
  const w = window as unknown as { __gpuModelLock?: string }
  const deadline = Date.now() + 20_000
  while (w.__gpuModelLock && w.__gpuModelLock !== 'kokoro' && Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 200))
  }
  if (w.__gpuModelLock && w.__gpuModelLock !== 'kokoro') {
    console.log(`[kokoro-tts] Timed out waiting for GPU lock (${w.__gpuModelLock})`)
    throw new Error('GPU busy — try again after current model finishes')
  }
  w.__gpuModelLock = 'kokoro'

  progressCb = onProgress ?? null
  loadPromise = _load().finally(() => {
    if (status !== 'ready') {
      loadPromise = null
      if (w.__gpuModelLock === 'kokoro') w.__gpuModelLock = undefined
    }
  })
  return loadPromise
}

// ─── Load: try Worker first, fall back to main thread ────────────────────────

async function _load(): Promise<void> {
  status = 'loading'
  progressCb?.(5, 'Loading Kokoro TTS...')

  const gpuAvailable = await hasWebGPU()
  const device = gpuAvailable ? 'webgpu' : 'wasm'
  const dtype = gpuAvailable ? 'fp32' : 'q8'
  activeDevice = device

  // Try Web Worker first (off-thread synthesis)
  try {
    await _loadViaWorker(device, dtype)
    return
  } catch (workerErr) {
    console.warn('[kokoro-tts] Web Worker failed, falling back to main thread:', workerErr)
  }

  // Fallback: load on main thread
  await _loadMainThread(device, dtype)
}

async function _loadViaWorker(device: string, dtype: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      worker = new Worker(new URL('./tts-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new Error('Worker creation failed'))
      return
    }

    const initId = ++msgId
    const timeout = setTimeout(() => {
      reject(new Error('Worker init timeout'))
    }, 120000)

    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.id === initId) {
        if (msg.type === 'ready') {
          clearTimeout(timeout)
          workerReady = true
          status = 'ready'
          resetIdleTimer()
          if (device === 'webgpu') attachGpuLostHandler().catch(() => {})
          progressCb?.(100, `Voice model ready (${device}, worker)`)
          console.log(`[kokoro-tts] Loaded on ${device} via Web Worker`)
          resolve()
        } else if (msg.type === 'progress') {
          const pct = 15 + Math.round((msg.pct ?? 0) * 0.8)
          progressCb?.(pct, msg.text)
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          reject(new Error(msg.message))
        }
      }
    }

    worker.onerror = (err) => {
      clearTimeout(timeout)
      reject(err)
    }

    worker.postMessage({ type: 'init', id: initId, device, dtype })
  })
}

async function _loadMainThread(device: string, dtype: string): Promise<void> {
  progressCb?.(15, `Downloading voice model (${device})...`)

  try {
    const { KokoroTTS } = await import('kokoro-js')

    try {
      fallbackEngine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: dtype as 'q8',
        device: device as 'webgpu',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (p: any) => {
          if (p.progress != null) {
            progressCb?.(15 + Math.round(p.progress * 0.8), `Downloading voice model (${device})...`)
          }
        },
      })
    } catch (gpuErr) {
      if (device === 'webgpu') {
        console.warn('[kokoro-tts] WebGPU failed, trying WASM:', gpuErr)
        activeDevice = 'wasm'
        fallbackEngine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'wasm',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          progress_callback: (p: any) => {
            if (p.progress != null) {
              progressCb?.(15 + Math.round(p.progress * 0.8), 'Downloading voice model (WASM)...')
            }
          },
        })
      } else {
        throw gpuErr
      }
    }

    status = 'ready'
    resetIdleTimer()
    if (activeDevice === 'webgpu') attachGpuLostHandler().catch(() => {})
    progressCb?.(100, `Voice model ready (${activeDevice}, main thread)`)
    console.log(`[kokoro-tts] Loaded on ${activeDevice} (main thread fallback)`)
  } catch (err) {
    status = 'failed'
    loadPromise = null
    console.error('[kokoro-tts] Failed to load:', err)
    throw err
  }
}

export async function unloadKokoro(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (worker) {
    worker.terminate()
    worker = null
    workerReady = false
  }
  // Try to explicitly dispose the fallback engine (frees WebGPU buffers)
  if (fallbackEngine) {
    try {
      const eng = fallbackEngine as { dispose?: () => Promise<void> | void }
      if (typeof eng.dispose === 'function') await eng.dispose()
    } catch { /* ignore */ }
  }
  fallbackEngine = null
  loadPromise = null
  status = 'idle'
  // Release GPU mutex so Gemma can load again
  const w = window as unknown as { __gpuModelLock?: string }
  if (w.__gpuModelLock === 'kokoro') w.__gpuModelLock = undefined
  closeAudioContext()
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

/**
 * Synthesize text to PCM audio.
 * Uses Web Worker (zero main-thread blocking) or falls back to main thread.
 */
export async function synthesize(
  text: string,
  speaker: 'A' | 'B'
): Promise<{ audio: Float32Array; sampleRate: number }> {
  const voice = VOICES[speaker]
  resetIdleTimer()

  if (workerReady && worker) {
    return synthesizeViaWorker(text, voice)
  }

  if (fallbackEngine) {
    const result = await fallbackEngine.generate(text, { voice })
    return { audio: result.audio, sampleRate: result.sampling_rate }
  }

  throw new Error('Kokoro not loaded')
}

function synthesizeViaWorker(text: string, voice: string): Promise<{ audio: Float32Array; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    if (!worker) { reject(new Error('No worker')); return }

    const id = ++msgId
    const timeout = setTimeout(() => reject(new Error('Synthesis timeout')), 30000)

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return
      clearTimeout(timeout)
      worker?.removeEventListener('message', handler)

      if (e.data.type === 'pcm') {
        resolve({ audio: e.data.audio, sampleRate: e.data.sampleRate })
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.message))
      }
    }

    worker.addEventListener('message', handler)
    worker.postMessage({ type: 'synthesize', id, text, voice })
  })
}

// ─── Audio Playback (broadcast quality) ──────────────────────────────────────

export function closeAudioContext(): void {
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close()
  }
  audioCtx = null
  compressor = null
  highpass = null
  presence = null
}

/**
 * Play PCM through the broadcast-quality audio processing chain:
 * Source → Highpass (80Hz) → Presence (+3dB @ 3kHz) → Compressor (4:1) → Speakers
 */
export function playPcm(
  audio: Float32Array,
  sampleRate: number,
  playbackRate = 1.0,
): Promise<void> {
  return new Promise((resolve) => {
    const { ctx, input } = getAudioPipeline(sampleRate)
    if (ctx.state === 'suspended') ctx.resume()

    const buffer = ctx.createBuffer(1, audio.length, sampleRate)
    buffer.getChannelData(0).set(audio)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playbackRate
    source.connect(input)  // goes through EQ → compressor → speakers
    source.onended = () => resolve()
    source.start()
  })
}
