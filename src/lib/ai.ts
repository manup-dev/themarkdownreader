/**
 * AI inference layer with streaming support.
 * Backend priority: 1) OpenRouter (cloud)  2) Ollama (local)  3) WebLLM (browser)
 * Supports streaming via onToken callback for all backends.
 */

import { PROMPTS, PROMPT_CONFIG } from './prompts'

// ─── Config ────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = (typeof localStorage !== 'undefined' && localStorage.getItem('md-reader-ollama-url')) || import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = 'qwen2.5:1.5b'
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

type Backend = 'openrouter' | 'ollama' | 'webllm' | 'none'
let activeBackend: Backend = 'none'
let backendDetected = false
let detectPromise: Promise<Backend> | null = null  // mutex: prevents concurrent detection

export function getActiveBackend(): Backend { return activeBackend }

// ─── API key management ────────────────────────────────────────────────────

export function setApiKey(key: string): void {
  localStorage.setItem(OPENROUTER_KEY_STORAGE, key)
  // Reset detection so next call re-evaluates with the new key
  backendDetected = false
}

export function getApiKey(): string | null {
  return localStorage.getItem(OPENROUTER_KEY_STORAGE)
}

export function clearApiKey(): void {
  localStorage.removeItem(OPENROUTER_KEY_STORAGE)
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
    const adapter = await nav.gpu.requestAdapter()
    return adapter !== null
  } catch { return false }
}

async function checkOpenRouter(): Promise<boolean> {
  const key = getApiKey()
  return key !== null && key.trim().length > 0
}

export async function detectBestBackend(): Promise<Backend> {
  if (backendDetected) return activeBackend
  // Mutex: if detection is already running, wait for it instead of starting another
  if (detectPromise) return detectPromise
  detectPromise = (async () => {
    try {
      // 1. OpenRouter — if user has set an API key
      if (await checkOpenRouter()) {
        activeBackend = 'openrouter'
        backendDetected = true
        return activeBackend
      }

      // 2. Ollama — local server
      if (await checkOllamaHealth()) {
        activeBackend = 'ollama'
        backendDetected = true
        return activeBackend
      }

      // 3. WebLLM — needs WebGPU
      if (await checkWebGPU()) {
        activeBackend = 'webllm'
        backendDetected = true
        return activeBackend
      }

      activeBackend = 'none'
      backendDetected = true
      return activeBackend
    } finally {
      detectPromise = null
    }
  })()
  return detectPromise
}

// ─── WebLLM engine (lazy loaded) ───────────────────────────────────────────

let webllmEngine: WebLLMEngine | null = null
let webllmLoading = false
let webllmReady = false

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
    return webllmEngine
  } catch (e) {
    webllmLoading = false
    webllmLoadPromise = null
    throw e
  }
  })()
  return webllmLoadPromise
}

// ─── OpenRouter streaming chat (SSE, OpenAI-compatible) ───────────────────

async function chatOpenRouterStream(
  messages: ChatMessage[],
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenRouter API key not set')

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
      max_tokens: PROMPT_CONFIG.maxTokens,
      temperature: PROMPT_CONFIG.temperature,
    }),
    signal: signal ?? AbortSignal.timeout(OPENROUTER_TIMEOUT),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${body}`)
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
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      keep_alive: '30m',
      options: { num_predict: PROMPT_CONFIG.maxTokens, temperature: PROMPT_CONFIG.temperature },
    }),
    signal: signal ?? AbortSignal.timeout(OLLAMA_TIMEOUT),
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

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
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line)
        const token = json.message?.content ?? ''
        if (token) {
          full += token
          onToken?.(token)
        }
      } catch { /* skip malformed */ }
    }
  }
  return full
}

// ─── Unified chat with streaming ───────────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  onToken?: (token: string) => void,
): Promise<string> {
  if (!backendDetected) await detectBestBackend()

  // Try OpenRouter
  if (activeBackend === 'openrouter') {
    try {
      return await chatOpenRouterStream(messages, onToken, signal)
    } catch (e) {
      console.warn('OpenRouter failed, trying fallbacks:', e)
      backendDetected = false  // Re-probe on next call (transient failure recovery)
      const ollamaOk = await checkOllamaHealth()
      if (ollamaOk) return chatOllamaStream(messages, onToken, signal)
      const hasGPU = await checkWebGPU()
      if (hasGPU) { activeBackend = 'webllm' }
      else throw new Error(`OpenRouter failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Try WebLLM
  if (activeBackend === 'webllm') {
    try {
      const engine = await getWebLLMEngine()
      const reply = await engine.chat.completions.create({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: PROMPT_CONFIG.temperature,
        max_tokens: PROMPT_CONFIG.maxTokens,
      })
      const content = reply.choices[0]?.message?.content ?? ''
      onToken?.(content)
      return content
    } catch {
      backendDetected = false  // Re-probe on next call
      const ollamaOk = await checkOllamaHealth()
      if (ollamaOk) return chatOllamaStream(messages, onToken, signal)
      throw new Error('No AI backend available')
    }
  }

  // Try Ollama
  if (activeBackend === 'ollama') {
    return chatOllamaStream(messages, onToken, signal)
  }

  throw new Error(
    'No AI backend available.\n' +
    '• Set an OpenRouter API key in Settings for cloud AI (free models available)\n' +
    '• Start Ollama locally (docker compose up)\n' +
    '• Use a WebGPU-capable browser (Chrome/Edge) for in-browser AI',
  )
}

// Re-export prompts for consumers
export { PROMPTS, PROMPT_CONFIG } from './prompts'

// ─── High-level AI functions ───────────────────────────────────────────────

export async function summarize(text: string, signal?: AbortSignal, onToken?: (t: string) => void): Promise<string> {
  return chat([
    { role: 'system', content: PROMPTS.summarize },
    { role: 'user', content: text.slice(0, PROMPT_CONFIG.summarizeMaxInput) },
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
  const numbered = contextChunks.map((c, i) => `[${i + 1}] ${c.slice(0, PROMPT_CONFIG.qaMaxChunkLen)}`).join('\n\n')
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

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? []).map((m: { name: string }) => m.name)
  } catch { return [] }
}
