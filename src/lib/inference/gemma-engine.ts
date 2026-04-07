/**
 * Browser inference engine via Transformers.js v4 (WebGPU/WASM).
 *
 * Model: Qwen3-0.6B (q4f16 quantization, ~500MB download)
 * Source: HuggingFace CDN (onnx-community/Qwen3-0.6B-ONNX)
 *
 * Exposes a simple async chat function matching the ChatMessage interface from ../ai.
 *
 * NOTE: File still named gemma-engine.ts for backwards compat — the public API
 * names (loadGemmaModel, gemmaChat, etc.) are used across 20+ files.
 */

import type { ChatMessage } from '../ai'
import { PROMPT_CONFIG } from '../prompts'

// ─── Constants ────────────────────────────────────────────────────────────────

const HF_MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'
const MODEL_DTYPE = 'q4f16'
const MODEL_DOWNLOAD_SIZE_MB = 500 // approximate, for user confirmation
const LOAD_TIMEOUT_MS = 180_000
const IDLE_TIMEOUT_MS = 60_000 // 1 minute — free GPU memory quickly

/** Check if device has enough memory for model (~500MB needed for q4f16) */
function hasEnoughMemory(): boolean {
  const nav = navigator as unknown as { deviceMemory?: number }
  // deviceMemory reports GB of RAM (rounded). Skip on ≤2GB devices.
  if (nav.deviceMemory && nav.deviceMemory <= 2) {
    console.log(`[browser-ai] Skipping — only ${nav.deviceMemory}GB device memory`)
    return false
  }
  return true
}

/** Estimated download size in MB (for UI confirmation dialogs) */
export function getModelDownloadSizeMB(): number {
  return MODEL_DOWNLOAD_SIZE_MB
}
let idleTimer: ReturnType<typeof setTimeout> | null = null

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (status === 'ready') {
      console.log('[browser-ai] Idle timeout — unloading model to free memory')
      unloadGemma()
    }
  }, IDLE_TIMEOUT_MS)
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type GemmaStatus = 'idle' | 'loading' | 'ready' | 'failed'

let status: GemmaStatus = 'idle'
let loadError: string | null = null

// Loaded model artefacts (kept in module scope to survive across calls)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null

// Progress callbacks
type ProgressCallback = (progress: { status: GemmaStatus; percent?: number; message?: string }) => void
const progressListeners: Set<ProgressCallback> = new Set()

function notifyProgress(payload: { status: GemmaStatus; percent?: number; message?: string }) {
  for (const cb of progressListeners) {
    try { cb(payload) } catch { /* ignore listener errors */ }
  }
}

export function onGemmaProgress(cb: ProgressCallback): () => void {
  progressListeners.add(cb)
  return () => progressListeners.delete(cb)
}

export function getGemmaStatus(): GemmaStatus {
  return status
}

// ─── Lazy-load Transformers.js ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTransformers(): Promise<any> {
  // Dynamic import so the heavy bundle is never loaded until needed
  return import('@huggingface/transformers')
}

// ─── Load model ───────────────────────────────────────────────────────────────

let loadPromise: Promise<void> | null = null

/** Global GPU model mutex — prevents Gemma + Kokoro loading simultaneously */
function acquireGpuLock(owner: string): boolean {
  const w = window as unknown as { __gpuModelLock?: string }
  if (w.__gpuModelLock && w.__gpuModelLock !== owner) return false
  w.__gpuModelLock = owner
  return true
}
function releaseGpuLock(owner: string): void {
  const w = window as unknown as { __gpuModelLock?: string }
  if (w.__gpuModelLock === owner) w.__gpuModelLock = undefined
}
export function isGemmaHoldingGpu(): boolean {
  const w = window as unknown as { __gpuModelLock?: string }
  return w.__gpuModelLock === 'gemma'
}

/** Check if model weights are already cached in the browser */
async function isModelCached(): Promise<boolean> {
  try {
    // Transformers.js uses the Cache API under the hood
    const cacheNames = await caches.keys()
    const tfCache = cacheNames.find(n => n.includes('transformers'))
    if (!tfCache) return false
    const cache = await caches.open(tfCache)
    const keys = await cache.keys()
    return keys.some(k => k.url.includes('Qwen3') || k.url.includes('qwen3'))
  } catch { return false }
}

export async function loadGemmaModel(skipConfirmation = false): Promise<void> {
  if (status === 'ready') return
  if (loadPromise) return loadPromise

  // Show download confirmation if model isn't cached yet
  if (!skipConfirmation) {
    const cached = await isModelCached()
    if (!cached) {
      const ok = window.confirm(
        `This will download a ${MODEL_DOWNLOAD_SIZE_MB}MB AI model to run locally in your browser. ` +
        `Once cached, it won't need to download again.\n\nContinue?`
      )
      if (!ok) {
        throw new Error('User cancelled model download')
      }
    }
  }

  if (!acquireGpuLock('gemma')) {
    status = 'failed'
    loadError = 'GPU busy (another model loading)'
    notifyProgress({ status: 'failed', message: loadError })
    throw new Error(loadError)
  }
  if (!hasEnoughMemory()) {
    status = 'failed'
    loadError = 'Insufficient device memory'
    notifyProgress({ status: 'failed', message: loadError })
    throw new Error(loadError)
  }

  loadPromise = _load().finally(() => {
    // Reset the promise reference so callers can retry after failure
    if (status !== 'ready') loadPromise = null
  })
  return loadPromise
}

async function _load(): Promise<void> {
  status = 'loading'
  loadError = null
  notifyProgress({ status: 'loading', percent: 0, message: 'Initialising…' })

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Model load timed out after 180 s')), LOAD_TIMEOUT_MS),
  )

  try {
    await Promise.race([_loadInner(), timeout])
    status = 'ready'
    resetIdleTimer()
    notifyProgress({ status: 'ready', percent: 100, message: 'Model ready' })
  } catch (err) {
    status = 'failed'
    releaseGpuLock('gemma')
    loadError = err instanceof Error ? err.message : String(err)
    notifyProgress({ status: 'failed', message: loadError ?? undefined })
    throw err
  }
}

async function _loadInner(): Promise<void> {
  const { AutoTokenizer, AutoModelForCausalLM, env } = await getTransformers()

  // Allow WASM/ONNX files to be fetched cross-origin (standard HF CDN)
  env.allowLocalModels = false
  env.useBrowserCache = true

  // Step 1: load tokenizer
  notifyProgress({ status: 'loading', percent: 10, message: 'Loading tokenizer…' })
  tokenizer = await AutoTokenizer.from_pretrained(HF_MODEL_ID)

  // Step 2: load model weights (q4f16 quantization)
  // Try WebGPU first; if context creation fails, fall back to WASM
  const progressCb = (p: { progress?: number }) => {
    const pct = p.progress != null ? 30 + Math.round(p.progress * 0.6) : undefined
    notifyProgress({ status: 'loading', percent: pct, message: 'Downloading model weights…' })
  }

  notifyProgress({ status: 'loading', percent: 30, message: 'Loading ONNX weights (WebGPU)…' })
  try {
    model = await AutoModelForCausalLM.from_pretrained(HF_MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'webgpu',
      progress_callback: progressCb,
    })
  } catch (webgpuErr) {
    console.warn('[browser-ai] WebGPU context failed, falling back to WASM:', webgpuErr)
    notifyProgress({ status: 'loading', percent: 30, message: 'Loading ONNX weights (WASM)…' })
    model = await AutoModelForCausalLM.from_pretrained(HF_MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'wasm',
      progress_callback: progressCb,
    })
  }
}

// ─── Unload ───────────────────────────────────────────────────────────────────

export async function unloadGemma(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  releaseGpuLock('gemma')
  if (model?.dispose) {
    try { await model.dispose() } catch { /* ignore */ }
  }
  tokenizer = null
  model = null
  loadPromise = null
  loadError = null
  status = 'idle'
  notifyProgress({ status: 'idle', message: 'Model unloaded' })
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Run a chat completion using the loaded Gemma model.
 *
 * @param messages  Conversation history (system / user / assistant turns)
 * @param onToken   Optional streaming callback — called with each decoded token
 * @param signal    Optional AbortSignal for cancellation
 * @returns         Full assistant reply string
 */
export async function gemmaChat(
  messages: ChatMessage[],
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (status !== 'ready') {
    await loadGemmaModel()
  }

  if (!tokenizer || !model) {
    throw new Error('Browser model not loaded')
  }

  // Format messages into a single prompt string using the chat template
  const promptText: string = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_tensor: false,
  })

  // Tokenize the prompt
  const inputs = tokenizer(promptText, { return_tensors: 'pt' })
  const inputIds = inputs.input_ids
  const inputLength: number = inputIds.dims[1] as number

  // Collect streamed token IDs for final decode
  const outputTokenIds: number[] = []
  // Track last decoded text for streaming delta
  let lastDecodedLength = 0

  const callbackFunction = onToken
    ? (beams: Array<{ output_token_ids: number[] }>) => {
        if (signal?.aborted) return false  // returning false stops generation

        const currentTokenIds = beams[0]?.output_token_ids
        if (!currentTokenIds) return

        // Only process new tokens beyond the input prompt
        const newTokenIds = currentTokenIds.slice(inputLength)
        outputTokenIds.length = 0
        outputTokenIds.push(...newTokenIds)

        // Decode full new sequence so far, then emit the delta
        const decodedSoFar: string = tokenizer.decode(newTokenIds, {
          skip_special_tokens: true,
        })
        const delta = decodedSoFar.slice(lastDecodedLength)
        lastDecodedLength = decodedSoFar.length
        if (delta) onToken(delta)
      }
    : undefined

  // Run generation
  const output = await model.generate(inputIds, {
    max_new_tokens: PROMPT_CONFIG.maxTokens,
    temperature: PROMPT_CONFIG.temperature,
    do_sample: PROMPT_CONFIG.temperature > 0,
    ...(callbackFunction ? { callback_function: callbackFunction } : {}),
  })

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // Decode the full output, stripping special tokens
  // Model returns full sequence (prompt + completion); slice off the prompt
  const outputTensor = output[0] ?? output
  // data may be BigInt64Array (WebGPU path) or Int32Array (WASM path)
  const rawData = outputTensor.data as ArrayLike<bigint | number>
  const fullTokenIds: number[] = Array.from({ length: rawData.length }, (_, i) =>
    Number(rawData[i]),
  )
  const newTokens = fullTokenIds.slice(inputLength)
  const reply: string = tokenizer.decode(newTokens, { skip_special_tokens: true })

  resetIdleTimer()
  return reply.trim()
}
