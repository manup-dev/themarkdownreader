/**
 * Gemma 4 E2B inference engine via Transformers.js v4 (WebGPU/WASM).
 *
 * Primary source:  HuggingFace CDN  (onnx-community/gemma-4-E2B-it-ONNX)
 * Fallback source: GitHub Releases  (manup-dev/themarkdownreader)
 *
 * Exposes a simple async chat function matching the ChatMessage interface from ../ai.
 */

import type { ChatMessage } from '../ai'
import { PROMPT_CONFIG } from '../prompts'

// ─── Constants ────────────────────────────────────────────────────────────────

const HF_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX'
const GH_BASE_URL =
  'https://github.com/manup-dev/themarkdownreader/releases/download/models-v1'
const LOAD_TIMEOUT_MS = 180_000

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

export async function loadGemmaModel(): Promise<void> {
  if (status === 'ready') return
  if (loadPromise) return loadPromise

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
    notifyProgress({ status: 'ready', percent: 100, message: 'Model ready' })
  } catch (err) {
    status = 'failed'
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

  let modelSource: string = HF_MODEL_ID

  // Step 1: load tokenizer — try HF first, fall back to GitHub Releases
  notifyProgress({ status: 'loading', percent: 10, message: 'Loading tokenizer…' })
  try {
    tokenizer = await AutoTokenizer.from_pretrained(HF_MODEL_ID)
  } catch (hfErr) {
    console.warn('[gemma-engine] HF tokenizer load failed, trying GitHub fallback:', hfErr)
    modelSource = GH_BASE_URL
    tokenizer = await AutoTokenizer.from_pretrained(GH_BASE_URL)
  }

  // Step 2: load model weights from the same source that succeeded for tokenizer
  notifyProgress({ status: 'loading', percent: 30, message: 'Loading ONNX weights…' })
  model = await AutoModelForCausalLM.from_pretrained(modelSource, {
    dtype: 'q4',
    device: 'webgpu',
    progress_callback: (p: { progress?: number }) => {
      const pct = p.progress != null ? 30 + Math.round(p.progress * 0.6) : undefined
      notifyProgress({ status: 'loading', percent: pct, message: 'Loading ONNX weights…' })
    },
  })
}

// ─── Unload ───────────────────────────────────────────────────────────────────

export async function unloadGemma(): Promise<void> {
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
    throw new Error('Gemma model not loaded')
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
  // Gemma returns full sequence (prompt + completion); slice off the prompt
  const outputTensor = output[0] ?? output
  // data may be BigInt64Array (WebGPU path) or Int32Array (WASM path)
  const rawData = outputTensor.data as ArrayLike<bigint | number>
  const fullTokenIds: number[] = Array.from({ length: rawData.length }, (_, i) =>
    Number(rawData[i]),
  )
  const newTokens = fullTokenIds.slice(inputLength)
  const reply: string = tokenizer.decode(newTokens, { skip_special_tokens: true })

  return reply.trim()
}
