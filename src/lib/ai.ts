/**
 * AI inference layer with streaming support.
 * Backend priority: 1) Gemma 4 (browser WebGPU)  2) WebLLM (browser)  3) Ollama (local)  4) OpenRouter (cloud)
 * Supports streaming via onToken callback for all backends.
 */

import { PROMPTS, PROMPT_CONFIG } from './prompts'
import { gemmaChat, loadGemmaModel } from './inference/gemma-engine'
import { getModelState, waitForReady } from './inference/model-manager'

// ─── Config ────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = (typeof localStorage !== 'undefined' && localStorage.getItem('md-reader-ollama-url')) || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OLLAMA_URL) || 'http://localhost:11434'
export function getOllamaBaseUrl(): string { return OLLAMA_BASE_URL }
const OLLAMA_MODEL = 'qwen3:0.6b'
const OLLAMA_TIMEOUT = 90000

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_FREE_MODEL = 'meta-llama/llama-3.2-3b-instruct:free'
const OPENROUTER_TIMEOUT = 60000
const OPENROUTER_KEY_STORAGE = 'md-reader-openrouter-key'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface WebLLMEngine {
  chat: {
    completions: {
      create: (opts: {
        messages: Array<{ role: string; content: string }>
        temperature: number
        max_tokens: number
      }) => Promise<{ choices: Array<{ message: { content: string } }> }>
    }
  }
}

type Backend = 'gemma4' | 'webllm' | 'ollama' | 'openrouter' | 'none'
let activeBackend: Backend = 'none'
let backendDetected = false
let detectPromise: Promise<Backend> | null = null  // mutex: prevents concurrent detection

// ─── Backend readiness + change events ────────────────────────────────────
// Consumers (Chat, Coach, SummaryCards, Toolbar, AiLoadingIndicator) all need
// to know: (1) is the currently-active backend ready to serve a chat call?
// and (2) when did it change? Centralizing both here prevents drift — the bug
// that prompted this refactor was Chat.tsx's inline allowlist missing 'gemma4'
// after it was added as the default WebGPU backend, leaving every Chrome/Edge
// user with a permanently-disabled "Waiting for AI..." input.

const backendListeners = new Set<(b: Backend) => void>()

/**
 * Returns true if the given backend name corresponds to a real, usable backend.
 * Keep this as the single source of truth for "can we chat right now?".
 *
 * IMPORTANT: If you add a new backend to the Backend union type, add it here
 * too. There's a test in src/test/ai-backend.test.ts pinning this invariant.
 */
export function isBackendReady(backend: string): boolean {
  return (
    backend === 'gemma4' ||
    backend === 'webllm' ||
    backend === 'ollama' ||
    backend === 'openrouter'
  )
}

/**
 * Subscribe to backend-change events. Fires whenever `activeBackend` is
 * mutated by detection, re-detection, or user preference changes.
 * Returns an unsubscribe function.
 */
export function onBackendChange(cb: (backend: Backend) => void): () => void {
  backendListeners.add(cb)
  return () => backendListeners.delete(cb)
}

function setActiveBackend(next: Backend): void {
  if (activeBackend === next) return
  activeBackend = next
  for (const cb of backendListeners) {
    try { cb(activeBackend) } catch { /* listener errors must not break detection */ }
  }
}

export function getActiveBackend(): Backend { return activeBackend }

/**
 * Force re-detection of the best available backend, skipping Gemma 4.
 * Called when Gemma fails after initial detection — finds the next fallback.
 */
export async function redetectBackend(): Promise<Backend> {
  // Skip Gemma/WebLLM (both use WebGPU and Gemma just failed) — try server backends
  if (await checkOllamaHealth()) { setActiveBackend('ollama'); backendDetected = true; return activeBackend }
  if (await checkOpenRouter()) { setActiveBackend('openrouter'); backendDetected = true; return activeBackend }
  setActiveBackend('none')
  backendDetected = true
  return activeBackend
}

// ─── API key management ────────────────────────────────────────────────────

/**
 * Canonicalize a key on both read and write so no code path can send a header
 * containing trailing whitespace, newlines, or zero-width characters. This
 * was previously a real bug: users pasted keys with copy-paste artifacts, the
 * Test button used `apiKey.trim()` on React state so it succeeded, but the
 * actual chat call sent the raw stored value and OpenRouter returned
 * "401 missing authentication header" because the Authorization header was
 * malformed. Defense in depth — we sanitize on write AND read AND usage.
 */
function canonicalizeKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Strip all whitespace (including zero-width and non-breaking spaces) from
  // both ends. OpenRouter keys are always `sk-or-...` ASCII so aggressive
  // stripping is safe.
  const cleaned = raw.replace(/^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g, '')
  return cleaned || null
}

export function setApiKey(key: string): void {
  const cleaned = canonicalizeKey(key)
  if (cleaned) {
    localStorage.setItem(OPENROUTER_KEY_STORAGE, cleaned)
  } else {
    localStorage.removeItem(OPENROUTER_KEY_STORAGE)
  }
  // Reset detection so next call re-evaluates with the new key
  backendDetected = false
}

export function getApiKey(): string | null {
  return canonicalizeKey(localStorage.getItem(OPENROUTER_KEY_STORAGE))
}

export function clearApiKey(): void {
  localStorage.removeItem(OPENROUTER_KEY_STORAGE)
  backendDetected = false
}

// ─── Preferred backend override ────────────────────────────────────────────

const LS_PREFERRED_BACKEND = 'md-reader-preferred-backend'

export function getPreferredBackend(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(LS_PREFERRED_BACKEND) : null
}

export function setPreferredBackend(backend: string | null): void {
  if (backend) {
    localStorage.setItem(LS_PREFERRED_BACKEND, backend)
  } else {
    localStorage.removeItem(LS_PREFERRED_BACKEND)
  }
  backendDetected = false
}

// ─── Backend detection ─────────────────────────────────────────────────────

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch { return false }
}

async function checkWebGPU(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }
    if (!nav.gpu) return false
    // Timeout: requestAdapter() can hang in VS Code webview sandbox
    const adapter = await Promise.race([
      nav.gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ])
    return adapter !== null
  } catch { return false }
}

async function checkOpenRouter(): Promise<boolean> {
  const key = getApiKey()
  return key !== null && key.trim().length > 0
}

export async function detectBestBackend(): Promise<Backend> {
  if (backendDetected) return activeBackend
  if (detectPromise) return detectPromise
  detectPromise = (async () => {
    try {
      const preferred = getPreferredBackend()
      if (preferred && preferred !== 'auto') {
        if (preferred === 'gemma4' && await checkWebGPU()) { setActiveBackend('gemma4'); backendDetected = true; return activeBackend }
        if (preferred === 'webllm' && await checkWebGPU()) { setActiveBackend('webllm'); backendDetected = true; return activeBackend }
        if (preferred === 'ollama' && await checkOllamaHealth()) { setActiveBackend('ollama'); backendDetected = true; return activeBackend }
        if (preferred === 'openrouter' && await checkOpenRouter()) { setActiveBackend('openrouter'); backendDetected = true; return activeBackend }
        // preferred not available, fall through to auto-detect
      }

      // Auto: config-first, then browser.
      // Principle: if the user has explicitly configured a zero-setup backend
      // (Ollama running, OpenRouter key set), respect that — they don't need
      // and may not want a 500MB model download. Only fall back to WebGPU
      // gemma4 (which requires a download) when nothing else is available.
      // This was previously "browser-first" and it trapped users who'd
      // already given the app a cloud key into a 500MB model download loop.
      if (await checkOllamaHealth()) { setActiveBackend('ollama'); backendDetected = true; return activeBackend }
      if (await checkOpenRouter()) { setActiveBackend('openrouter'); backendDetected = true; return activeBackend }
      if (await checkWebGPU()) { setActiveBackend('gemma4'); backendDetected = true; return activeBackend }

      setActiveBackend('none')
      backendDetected = true
      return activeBackend
    } finally {
      detectPromise = null
    }
  })()
  return detectPromise
}

// ─── WebLLM engine (lazy loaded) ───────────────────────────────────────────

const WEBLLM_IDLE_TIMEOUT_MS = 120_000 // 2 minutes — free VRAM aggressively

let webllmEngine: WebLLMEngine | null = null
let webllmLoading = false
let webllmReady = false
let webllmIdleTimer: ReturnType<typeof setTimeout> | null = null

function resetWebLLMIdleTimer(): void {
  if (webllmIdleTimer) clearTimeout(webllmIdleTimer)
  webllmIdleTimer = setTimeout(() => {
    if (webllmReady) {
      console.log('[webllm] Idle timeout — unloading to free VRAM')
      unloadWebLLM().catch(() => { /* non-fatal */ })
    }
  }, WEBLLM_IDLE_TIMEOUT_MS)
}

/** Explicitly unload WebLLM to free GPU VRAM. */
export async function unloadWebLLM(): Promise<void> {
  if (webllmIdleTimer) { clearTimeout(webllmIdleTimer); webllmIdleTimer = null }
  if (!webllmEngine) return
  try {
    // WebLLM exposes unload() / dispose() methods on newer versions
    const engine = webllmEngine as unknown as { unload?: () => Promise<void>; dispose?: () => void }
    if (typeof engine.unload === 'function') await engine.unload()
    else if (typeof engine.dispose === 'function') engine.dispose()
  } catch (e) {
    console.warn('[webllm] Unload error:', e)
  }
  webllmEngine = null
  webllmReady = false
  webllmLoading = false
  webllmLoadPromise = null
}

export let webllmProgress = 0
export let webllmProgressText = ''
export let onProgressCallback: ((pct: number, text: string) => void) | null = null

export function onWebLLMProgress(cb: (pct: number, text: string) => void) {
  onProgressCallback = cb
}

let webllmLoadPromise: Promise<WebLLMEngine> | null = null

async function getWebLLMEngine(): Promise<WebLLMEngine> {
  if (webllmEngine && webllmReady) return webllmEngine
  if (webllmLoading && webllmLoadPromise) {
    const result = await Promise.race([
      webllmLoadPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WebLLM load timeout (120s)')), 120000)),
    ])
    if (result) return result
    throw new Error('WebLLM failed to load')
  }

  webllmLoading = true
  webllmLoadPromise = (async () => {
  try {
    const webllm = await import('@mlc-ai/web-llm')
    const engine = new webllm.MLCEngine()
    engine.setInitProgressCallback((report: { progress?: number; text?: string }) => {
      webllmProgress = report.progress ?? 0
      webllmProgressText = report.text ?? 'Loading...'
      onProgressCallback?.(webllmProgress, webllmProgressText)
    })
    await engine.reload('Qwen2.5-1.5B-Instruct-q4f16_1-MLC')
    webllmEngine = engine as unknown as WebLLMEngine
    webllmReady = true
    webllmLoading = false
    resetWebLLMIdleTimer()
    return webllmEngine
  } catch (e) {
    webllmLoading = false
    webllmLoadPromise = null
    throw e
  }
  })()
  return webllmLoadPromise
}

// ─── WebLLM chat ───────────────────────────────────────────────────────────

async function chatWebLLM(
  messages: ChatMessage[],
  onToken?: (token: string) => void,
): Promise<string> {
  const engine = await getWebLLMEngine()
  resetWebLLMIdleTimer()
  const reply = await engine.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: PROMPT_CONFIG.temperature,
    max_tokens: PROMPT_CONFIG.maxTokens,
  })
  const content = reply.choices[0]?.message?.content ?? ''
  onToken?.(content)
  resetWebLLMIdleTimer()
  return content
}

// ─── OpenRouter streaming chat (SSE, OpenAI-compatible) ───────────────────

async function chatOpenRouterStream(
  messages: ChatMessage[],
  onToken?: (token: string) => void,
  signal?: AbortSignal,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  const rawKey = getApiKey()
  if (!rawKey) throw new Error('OpenRouter API key not set')
  // Defense in depth: getApiKey() now canonicalizes, but a raw .trim() at the
  // usage site guarantees no code path can ever send `Bearer sk-or-...\n` to
  // OpenRouter, which was the root cause of "401 missing authentication header"
  // while the Test button (which already trimmed) reported success.
  const apiKey = rawKey.trim()

  const res = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'md-reader',
    },
    body: JSON.stringify({
      model: OPENROUTER_FREE_MODEL,
      messages,
      stream: true,
      max_tokens: maxTokens ?? PROMPT_CONFIG.maxTokens,
      temperature: temperature ?? PROMPT_CONFIG.temperature,
    }),
    signal: signal ?? AbortSignal.timeout(OPENROUTER_TIMEOUT),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Preserve the status code in the error so the UI can render a targeted
    // action (e.g. "re-enter your API key" on 401, "rate limited" on 429).
    const err = new Error(`OpenRouter error ${res.status}: ${body}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const token = json.choices?.[0]?.delta?.content ?? ''
        if (token) {
          full += token
          onToken?.(token)
        }
      } catch { /* skip malformed SSE line */ }
    }
  }
  return full
}

// ─── Ollama streaming chat ─────────────────────────────────────────────────

async function chatOllamaStream(
  messages: ChatMessage[],
  onToken?: (token: string) => void,
  signal?: AbortSignal,
  maxTokens?: number,
  temperature?: number,
  repeatPenalty?: number,
  modelOverride?: string,
): Promise<string> {
  const options: Record<string, number> = {
    num_predict: maxTokens ?? PROMPT_CONFIG.maxTokens,
    temperature: temperature ?? PROMPT_CONFIG.temperature,
    num_ctx: 4096,
  }
  if (repeatPenalty !== undefined) options.repeat_penalty = repeatPenalty

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelOverride ?? OLLAMA_MODEL,
      messages,
      stream: true,
      keep_alive: '30m',
      options,
    }),
    signal: signal ?? AbortSignal.timeout(OLLAMA_TIMEOUT),
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''
  let tokensSinceYield = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line)
        const token = json.message?.content ?? ''
        if (token) {
          full += token
          onToken?.(token)
          tokensSinceYield++
        }
      } catch { /* skip malformed */ }
    }
    // Yield to UI every ~30 tokens to prevent main-thread blocking
    if (onToken && tokensSinceYield >= 30) {
      tokensSinceYield = 0
      await new Promise<void>(r => setTimeout(r, 0))
    }
  }
  // Strip Qwen3-style thinking tags from output
  return full.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// ─── Unified chat with streaming ───────────────────────────────────────────

/**
 * Fast chat — skips backends that are still loading.
 * Uses whatever backend is ready NOW, without waiting for model downloads.
 * Ideal for podcast/batch generation where you don't want to block on Gemma loading.
 */
export interface ChatFastOptions {
  signal?: AbortSignal
  onToken?: (token: string) => void
  maxTokens?: number
  temperature?: number
  repeatPenalty?: number
  model?: string
}

export async function chatFast(
  messages: ChatMessage[],
  signalOrOpts?: AbortSignal | ChatFastOptions,
  onToken?: (token: string) => void,
): Promise<string> {
  // Support both legacy (signal, onToken) and new options-object signatures
  const opts: ChatFastOptions = signalOrOpts instanceof AbortSignal
    ? { signal: signalOrOpts, onToken }
    : signalOrOpts ?? {}
  const { signal, onToken: tokenCb, maxTokens, temperature, repeatPenalty, model } = { onToken, ...opts }

  // If browser model is the selected backend, use it only if already loaded.
  // chatFast never triggers a model download — that would block for minutes
  // and cause massive slowdown (especially on low-RAM devices like M2 MacBooks).
  if (activeBackend === 'gemma4') {
    const modelState = getModelState()
    if (modelState.status === 'ready') {
      try { return await gemmaChat(messages, tokenCb, signal) } catch { /* fall through */ }
    } else {
      // Model not loaded — prefer server backends instead of triggering download
      if (await checkOllamaHealth()) return chatOllamaStream(messages, tokenCb, signal, maxTokens, temperature, repeatPenalty, model)
      if (await checkOpenRouter()) return chatOpenRouterStream(messages, tokenCb, signal, maxTokens, temperature)
      throw new Error('No AI backend available. Open AI Settings to download the browser model or configure Ollama/OpenRouter.')
    }
  }

  // Non-browser backends
  if (await checkOllamaHealth()) return chatOllamaStream(messages, tokenCb, signal, maxTokens, temperature, repeatPenalty, model)
  if (await checkOpenRouter()) return chatOpenRouterStream(messages, tokenCb, signal, maxTokens, temperature)
  return chat(messages, signal, tokenCb)
}

export async function chat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  onToken?: (token: string) => void,
): Promise<string> {
  if (!backendDetected) await detectBestBackend()

  // Gemma 4 (primary)
  if (activeBackend === 'gemma4') {
    const modelState = getModelState()
    // If the model isn't already downloaded, don't trap the user in a 500MB
    // blocking download when a zero-setup backend is ready RIGHT NOW. This
    // specifically unblocks the case where auto-detect picked gemma4 because
    // WebGPU is available, but the user also has Ollama running or an
    // OpenRouter key set — they should get an answer immediately via the
    // ready backend, not wait minutes for the model to download.
    if (modelState.status !== 'ready') {
      if (await checkOllamaHealth()) {
        // Silently prefer Ollama; the browser model can still download in
        // the background via preloadGemma — next call may land on it.
        return chatOllamaStream(messages, onToken, signal)
      }
      if (await checkOpenRouter()) {
        return chatOpenRouterStream(messages, onToken, signal)
      }
      // No zero-setup fallback available — fall through to the normal
      // download + wait path.
    }

    try {
      if (modelState.status === 'downloading') {
        await waitForReady()
      } else if (modelState.status !== 'ready') {
        await loadGemmaModel()
      }
      return await gemmaChat(messages, onToken, signal)
    } catch (e) {
      console.warn('Gemma 4 failed, trying fallbacks:', e)
      try {
        if (await checkWebGPU()) return await chatWebLLM(messages, onToken)
      } catch { /* fall through */ }
      if (await checkOllamaHealth()) return chatOllamaStream(messages, onToken, signal)
      if (await checkOpenRouter()) return chatOpenRouterStream(messages, onToken, signal)
      throw new Error(`Gemma 4 failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  // WebLLM
  if (activeBackend === 'webllm') {
    try {
      return await chatWebLLM(messages, onToken)
    } catch {
      backendDetected = false
      if (await checkOllamaHealth()) return chatOllamaStream(messages, onToken, signal)
      throw new Error('No AI backend available')
    }
  }

  // Ollama
  if (activeBackend === 'ollama') {
    return chatOllamaStream(messages, onToken, signal)
  }

  // OpenRouter
  if (activeBackend === 'openrouter') {
    try {
      return await chatOpenRouterStream(messages, onToken, signal)
    } catch (e) {
      console.warn('OpenRouter failed:', e)
      backendDetected = false
      if (await checkOllamaHealth()) return chatOllamaStream(messages, onToken, signal)
      throw new Error(`OpenRouter failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  throw new Error(
    'No AI backend available.\n' +
    '• Use a WebGPU-capable browser (Chrome/Edge) for in-browser AI with Gemma 4\n' +
    '• Start Ollama locally (docker compose up)\n' +
    '• Set an OpenRouter API key in Settings for cloud AI',
  )
}

// Re-export prompts for consumers
export { PROMPTS, PROMPT_CONFIG } from './prompts'

// ─── High-level AI functions ───────────────────────────────────────────────

export async function summarize(text: string, signal?: AbortSignal, onToken?: (t: string) => void): Promise<string> {
  const maxInput = activeBackend === 'gemma4' ? 6000 : PROMPT_CONFIG.summarizeMaxInput
  return chat([
    { role: 'system', content: PROMPTS.summarize },
    { role: 'user', content: text.slice(0, maxInput) },
  ], signal, onToken)
}

export async function summarizeSection(text: string, signal?: AbortSignal): Promise<string> {
  return chat([
    { role: 'system', content: PROMPTS.summarizeSection },
    { role: 'user', content: text.slice(0, PROMPT_CONFIG.sectionMaxInput) },
  ], signal)
}

export async function askAboutDocument(
  question: string,
  contextChunks: string[],
  signal?: AbortSignal,
  onToken?: (t: string) => void,
): Promise<string> {
  const maxChunk = activeBackend === 'gemma4' ? 1500 : PROMPT_CONFIG.qaMaxChunkLen
  const numbered = contextChunks.map((c, i) => `[${i + 1}] ${c.slice(0, maxChunk)}`).join('\n\n')
  return chat([
    { role: 'system', content: PROMPTS.askDocument },
    { role: 'user', content: `Context:\n${numbered}\n\nQ: ${question}` },
  ], signal, onToken)
}

/**
 * Deterministic fallback: extract bolded terms + headings as concept nodes.
 * Connected by section co-occurrence. Guarantees a rich graph even without AI.
 */
function extractConceptsDeterministic(text: string): { nodes: Array<{ id: string; label: string; type: string }>; edges: Array<{ source: string; target: string; label: string }> } {
  const nodes: Array<{ id: string; label: string; type: string }> = []
  const seen = new Set<string>()

  // Extract headings as "concept" nodes
  const headings = text.match(/^#{1,3}\s+(.+)$/gm) ?? []
  for (const h of headings) {
    const label = h.replace(/^#+\s+/, '').trim()
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    if (!seen.has(id) && label.length > 2 && label.length < 60) {
      seen.add(id)
      nodes.push({ id, label, type: 'concept' })
    }
  }

  // Extract **bolded terms** as "technology" or "concept" nodes
  const bolded = text.match(/\*\*([^*]+)\*\*/g) ?? []
  for (const b of bolded) {
    const label = b.replace(/\*\*/g, '').trim()
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    if (!seen.has(id) && label.length > 2 && label.length < 40) {
      seen.add(id)
      nodes.push({ id, label, type: label.match(/^[A-Z]/) ? 'technology' : 'concept' })
    }
  }

  // Extract `code terms` as "technology" nodes
  const codeterms = text.match(/`([^`]+)`/g) ?? []
  for (const c of codeterms) {
    const label = c.replace(/`/g, '').trim()
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    if (!seen.has(id) && label.length > 2 && label.length < 30 && !label.includes(' ')) {
      seen.add(id)
      nodes.push({ id, label, type: 'technology' })
    }
  }

  // Extract ALL-CAPS acronyms (3+ letters) as "technology" nodes
  const acronyms = text.match(/\b[A-Z]{3,}\b/g) ?? []
  for (const a of acronyms) {
    const id = a.toLowerCase()
    if (!seen.has(id) && a.length >= 3 && a.length <= 10) {
      seen.add(id)
      nodes.push({ id, label: a, type: 'technology' })
    }
  }

  // Limit to 25 nodes max
  const limited = nodes.slice(0, 25)

  // Connect nodes that appear in the same section (heading + content block)
  const edges: Array<{ source: string; target: string; label: string }> = []
  const sections = text.split(/^#{1,3}\s+/m).filter(Boolean)
  for (const section of sections) {
    const sectionLower = section.toLowerCase()
    const present = limited.filter((n) => sectionLower.includes(n.label.toLowerCase()))
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length && edges.length < 20; j++) {
        const edgeId = `${present[i].id}-${present[j].id}`
        if (!edges.some((e) => `${e.source}-${e.target}` === edgeId)) {
          edges.push({ source: present[i].id, target: present[j].id, label: 'related' })
        }
      }
    }
  }

  return { nodes: limited, edges }
}

export async function extractConceptsAndRelations(
  text: string,
  signal?: AbortSignal,
): Promise<{ nodes: Array<{ id: string; label: string; type: string }>; edges: Array<{ source: string; target: string; label: string }> }> {
  // Try AI extraction first
  try {
    const raw = await chat([
      { role: 'system', content: PROMPTS.extractConcepts },
      { role: 'user', content: text.slice(0, PROMPT_CONFIG.conceptsMaxInput) },
    ], signal)
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed.nodes?.length >= 3) return parsed
    }
  } catch { /* fall through to deterministic */ }

  // Deterministic fallback: extract from markdown syntax
  return extractConceptsDeterministic(text)
}

export async function generateCoachExplanation(
  sectionText: string,
  docTitle: string,
  signal?: AbortSignal,
): Promise<string> {
  return chat([
    { role: 'system', content: PROMPTS.coach },
    { role: 'user', content: `Doc: "${docTitle}"\n\n${sectionText.slice(0, PROMPT_CONFIG.coachMaxInput)}` },
  ], signal)
}

export async function generateQuiz(
  text: string,
  signal?: AbortSignal,
): Promise<Array<{ question: string; options: string[]; correct: number; explanation: string }>> {
  const raw = await chat([
    { role: 'system', content: PROMPTS.quiz },
    { role: 'user', content: text.slice(0, PROMPT_CONFIG.quizMaxInput) },
  ], signal)

  // Try JSON parse first
  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].question && parsed[0].options) {
        return parsed
      }
    } catch { /* fall through to retry */ }
  }

  // Retry once with explicit JSON instruction
  const retry = await chat([
    { role: 'system', content: 'You are a quiz generator. Return ONLY a valid JSON array. No text before or after.' },
    { role: 'user', content: `Generate 2 multiple-choice questions from this text. Return JSON:\n[{"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"..."}]\n\nText: ${text.slice(0, 800)}` },
  ], signal)
  const retryMatch = retry.match(/\[[\s\S]*\]/)
  if (retryMatch) {
    try {
      const parsed = JSON.parse(retryMatch[0])
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch { /* give up */ }
  }

  throw new Error('Could not generate valid quiz questions. Try a different section with more content.')
}

export async function generateDiagramDSL(
  text: string,
  signal?: AbortSignal
): Promise<string> {
  const truncated = text.slice(0, PROMPT_CONFIG.diagramDSLMaxInput)
  const messages: ChatMessage[] = [
    { role: 'system', content: PROMPTS.diagramDSL },
    { role: 'user', content: truncated },
  ]
  // Diagrams need more tokens (800) to produce complete JSON with edges
  return chatFast(messages, { signal, maxTokens: 800 })
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? []).map((m: { name: string }) => m.name)
  } catch { return [] }
}

export { getModelState, onModelProgress, preloadGemma } from './inference/model-manager'
export { getGemmaStatus, unloadGemma, getModelDownloadSizeMB } from './inference/gemma-engine'
