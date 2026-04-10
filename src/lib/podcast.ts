import { chatFast, checkOllamaHealth, getOllamaBaseUrl, type ChatMessage } from './ai'
import { chunkMarkdown } from './markdown'
import { PROMPTS, PROMPT_CONFIG } from './prompts'
import { db, searchAcrossDocuments, type DocumentAnalysis, type AnalyzedChunk } from './docstore'
import { analyzeDocument } from './analysis'
import { ensureStorageBudget } from './storage-manager'
import { getPodcastPreset, type PodcastPreset } from './device-profile'

// ─── Ollama Pre-warm ────────────────────────────────────────────────────────

/** Fire a tiny prompt to ensure the Ollama model is loaded in VRAM before real work. */
async function prewarmOllama(): Promise<void> {
  if (!await checkOllamaHealth()) return
  try {
    await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        keep_alive: '30m',
        options: { num_predict: 1 },
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* non-fatal — real calls will retry */ }
}

export interface ScriptLine {
  speaker: 'A' | 'B'
  text: string
}

export interface PodcastSegment {
  speaker: 'A' | 'B'
  text: string
  rate: number
  pitch: number
  pauseBefore: number
}

export interface PodcastScript {
  title: string
  contentHash: string
  analysisId?: number
  segments: PodcastSegment[]
  scriptLines: ScriptLine[]
  scope: 'single' | 'deep' | 'project'
  persona: 'overview' | 'teacher' | 'interview'
  sourceDocIds: number[]
  createdAt: number
}

// ─── JSON Parsing (resilient to small model quirks) ──────────────────────────

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) return fenced[1].trim()
  const bracketStart = raw.indexOf('[')
  const bracketEnd = raw.lastIndexOf(']')
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    return raw.slice(bracketStart, bracketEnd + 1)
  }
  return raw.trim()
}

function repairJson(raw: string): string {
  let s = raw
  s = s.replace(/(?<=[{[,:])\s*'([^']*?)'\s*(?=[,}\]:])/g, '"$1"')
  s = s.replace(/,\s*([}\]])/g, '$1')
  s = s.replace(/{\s*(\w+)\s*:/g, '{"$1":')
  s = s.replace(/,\s*(\w+)\s*:/g, ',"$1":')
  return s
}

export function parsePodcastOutline(raw: string): string[] {
  const json = extractJson(raw)
  for (const attempt of [json, repairJson(json)]) {
    try {
      const parsed = JSON.parse(attempt)
      if (!Array.isArray(parsed)) continue
      const result = parsed.filter((s): s is string => typeof s === 'string').slice(0, 5)
      if (result.length > 0) return result
    } catch { /* try next */ }
  }
  const quoted = raw.match(/"([^"]{10,200})"/g)
  if (quoted && quoted.length >= 2) {
    return quoted.map(q => q.replace(/^"|"$/g, '')).slice(0, 5)
  }
  return []
}

export function parsePodcastScript(raw: string): ScriptLine[] {
  const json = extractJson(raw)
  for (const attempt of [json, repairJson(json)]) {
    try {
      const parsed = JSON.parse(attempt)
      if (!Array.isArray(parsed)) continue
      const lines = parsed.filter(
        (item): item is ScriptLine =>
          item && (item.speaker === 'A' || item.speaker === 'B') && typeof item.text === 'string'
      )
      if (lines.length > 0) return lines
    } catch { /* try next */ }
  }
  const lineRegex = /(?:Speaker\s+)?([AB]):\s*"?([^"\n]+)"?/g
  const fallbackLines: ScriptLine[] = []
  let match
  while ((match = lineRegex.exec(raw)) !== null) {
    fallbackLines.push({ speaker: match[1] as 'A' | 'B', text: match[2].trim() })
  }
  return fallbackLines
}

// ─── Speech Sanitization ─────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/\/\//g, '')
    .replace(/\//g, ' ')
    .replace(/\\/g, '')
    .replace(/[{}[\]]/g, '')
    .replace(/\*+/g, '')
    .replace(/_+/g, ' ')
    .replace(/#/g, '')
    .replace(/`/g, '')
    .replace(/\|/g, ' ')
    .replace(/—/g, ', ')
    .replace(/–/g, ', ')
    .replace(/\.{3,}/g, '...')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── Segment Building ────────────────────────────────────────────────────────

function buildChunkSourceText(chunk: AnalyzedChunk, rawText: string): string {
  switch (chunk.contentType) {
    case 'code':
      return '[code example]'
    case 'table': {
      const firstLine = rawText.split('\n').find(l => l.trim().startsWith('|'))
      return firstLine ? `[table comparing: ${firstLine.replace(/\|/g, ' ').trim()}]` : '[table]'
    }
    case 'diagram':
      return '[diagram reference]'
    default:
      return stripMarkdown(rawText)
  }
}

export function buildPodcastSegments(script: ScriptLine[], title: string): PodcastSegment[] {
  const segments: PodcastSegment[] = []

  segments.push({
    speaker: 'A',
    text: `Let's dive into ${title}.`,
    rate: 1.0,
    pitch: 1.0,
    pauseBefore: 0,
  })

  let prevSpeaker: 'A' | 'B' | null = 'A'
  for (const line of script) {
    const isSwitching = prevSpeaker !== null && prevSpeaker !== line.speaker
    const isShortReaction = line.text.split(/\s+/).length <= 5
    const rateJitter = (Math.random() - 0.5) * 0.1
    const pitchJitter = (Math.random() - 0.5) * 0.1
    const pause = isShortReaction ? 50 + Math.random() * 50 : isSwitching ? 80 + Math.random() * 120 : 60 + Math.random() * 80

    segments.push({
      speaker: line.speaker,
      text: sanitizeForSpeech(line.text),
      rate: (line.speaker === 'A' ? 1.0 : 1.05) + rateJitter,
      pitch: (line.speaker === 'A' ? 1.0 : 1.1) + pitchJitter,
      pauseBefore: Math.round(pause),
    })
    prevSpeaker = line.speaker
  }

  segments.push({
    speaker: 'A',
    text: `That wraps up our look at ${title}.`,
    rate: 1.0,
    pitch: 1.0,
    pauseBefore: 300,
  })

  return segments
}

// ─── Content Hash ────────────────────────────────────────────────────────────

async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Incremental Script Line Parser ─────────────────────────────────────────

/**
 * Parses ScriptLine objects from a growing token buffer.
 * Fires onLine() for each complete {"speaker":"A","text":"..."} as it arrives,
 * enabling TTS synthesis to start before the full response is complete.
 */
class IncrementalScriptParser {
  private buffer = ''
  private emittedCount = 0
  private onLine: (line: ScriptLine) => void

  constructor(onLine: (line: ScriptLine) => void) {
    this.onLine = onLine
  }

  push(token: string): void {
    this.buffer += token
    // Try to extract complete JSON objects from the growing buffer
    this._tryParse()
  }

  /** Return any remaining lines not yet emitted */
  flush(): ScriptLine[] {
    const all = parsePodcastScript(this.buffer)
    return all.slice(this.emittedCount)
  }

  private _tryParse(): void {
    // Match complete {"speaker":"A/B","text":"..."} objects
    const objRegex = /\{\s*"speaker"\s*:\s*"([AB])"\s*,\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"\s*\}/g
    let match: RegExpExecArray | null
    let count = 0
    while ((match = objRegex.exec(this.buffer)) !== null) {
      count++
      if (count > this.emittedCount) {
        this.emittedCount = count
        const text = match[2].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\')
        this.onLine({ speaker: match[1] as 'A' | 'B', text })
      }
    }
  }
}

// ─── Script Quality Validation ──────────────────────────────────────────────

function validateScript(lines: ScriptLine[], expectedCount: number): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  if (lines.length < expectedCount / 2)
    issues.push(`Too few exchanges: ${lines.length}/${expectedCount}`)

  const speakerA = lines.filter(l => l.speaker === 'A').length
  const speakerB = lines.filter(l => l.speaker === 'B').length
  if (speakerA === 0 || speakerB === 0)
    issues.push('Missing speaker')

  const longTurns = lines.filter(l => l.text.split(/\s+/).length > 80)
  if (longTurns.length > 0)
    issues.push(`${longTurns.length} turns over 80 words`)

  // Check for repetition: count unique sentence starters
  const starters = new Set(lines.map(l => l.text.split(/\s+/).slice(0, 3).join(' ').toLowerCase()))
  if (lines.length >= 6 && starters.size < lines.length / 3)
    issues.push('High repetition in sentence starters')

  return { valid: issues.length === 0, issues }
}

// ─── Theme Script Generation (single theme) ─────────────────────────────────

interface ThemeContext {
  themes: string[]
  currentIdx: number
  previousExchanges?: ScriptLine[]
}

async function generateThemeScript(
  theme: string,
  analysis: DocumentAnalysis | undefined,
  themeIdx: number,
  markdown: string,
  signal?: AbortSignal,
  onLine?: (line: ScriptLine) => void,
  duration: PodcastDuration = 'quick',
  themeContext?: ThemeContext,
  preset?: PodcastPreset,
  _retryCount = 0,
): Promise<ScriptLine[]> {
  const p = preset ?? getPodcastPreset()
  let relevantText = ''

  if (analysis) {
    const analysisTheme = analysis.themes[themeIdx]
    if (analysisTheme?.chunkIds && analysisTheme.chunkIds.length > 0) {
      const storedChunks = await db.chunks.bulkGet(analysisTheme.chunkIds)
      const chunkTexts: string[] = []
      for (const stored of storedChunks) {
        if (!stored) continue
        const annotated = analysis.chunks.find(ac => ac.chunkId === stored.id)
        if (annotated) {
          chunkTexts.push(buildChunkSourceText(annotated, stored.text))
        } else {
          chunkTexts.push(stored.text)
        }
      }
      relevantText = chunkTexts.join('\n\n').slice(0, PROMPT_CONFIG.podcastScriptMaxInput)
    }

    if (!relevantText.trim()) {
      try {
        const bm25Results = await searchAcrossDocuments(theme, 3)
        relevantText = bm25Results.map(r => r.text).join('\n\n').slice(0, PROMPT_CONFIG.podcastScriptMaxInput)
      } catch { /* use fallback */ }
    }
  }

  if (!relevantText.trim()) {
    const chunks = chunkMarkdown(markdown)
    const themeWords = theme.toLowerCase().split(/\s+/)
    relevantText = chunks
      .map(c => ({ chunk: c, score: themeWords.filter(w => c.text.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.chunk.text)
      .join('\n\n')
      .slice(0, PROMPT_CONFIG.podcastScriptMaxInput)
  }

  const exchangeCount = duration === 'detailed' ? p.exchangesPerThemeDetailed : p.exchangesPerThemeQuick
  const maxTokens = duration === 'detailed' ? p.maxTokensDetailed : p.maxTokensQuick
  const promptTemplate = duration === 'detailed' ? PROMPTS.podcastScriptDetailed : PROMPTS.podcastScript
  let prompt = promptTemplate.replace('{{EXCHANGE_COUNT}}', String(exchangeCount))

  // On retry, add guidance to avoid repetition
  if (_retryCount > 0) {
    prompt += '\nIMPORTANT: Be concise and varied. Use different sentence structures for each turn.'
  }

  // Build user message with optional context injection
  let userContent = ''
  if (themeContext && themeContext.themes.length > 1) {
    const prev = themeContext.themes.slice(0, themeContext.currentIdx)
    const next = themeContext.themes.slice(themeContext.currentIdx + 1)
    userContent += `This is topic ${themeContext.currentIdx + 1} of ${themeContext.themes.length}.`
    if (prev.length) userContent += `\nPrevious topics covered: ${prev.join(', ')}.`
    if (next.length) userContent += `\nUpcoming: ${next[0]}.`
    userContent += '\nConnect to previous topics if relevant.\n\n'
  }

  // Sliding window: include last 2 exchanges from previous theme for continuity
  if (themeContext?.previousExchanges && themeContext.previousExchanges.length > 0) {
    const prevLines = themeContext.previousExchanges
      .map(l => `${l.speaker === 'A' ? 'Alex' : 'Sam'}: "${l.text}"`)
      .join('\n')
    userContent += `Continue naturally from this conversation:\n${prevLines}\n\nNow transition to: `
  }

  userContent += `Theme: ${theme}\n\nSource material:\n${relevantText}`

  const scriptMessages: ChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: userContent },
  ]

  const temperature = p.scriptTemperature

  // If streaming callback provided, use incremental parsing for real-time TTS
  let lines: ScriptLine[]
  if (onLine) {
    const parser = new IncrementalScriptParser(onLine)
    const scriptRaw = await chatFast(scriptMessages, {
      signal,
      maxTokens,
      temperature,
      onToken: (token) => parser.push(token),
    })
    // Flush any remaining lines not caught by incremental parsing
    const remaining = parser.flush()
    const all = parsePodcastScript(scriptRaw)
    lines = (remaining.length > 0 && all.length > remaining.length) ? all : (all.length > 0 ? all : remaining)
  } else {
    const scriptRaw = await chatFast(scriptMessages, { signal, maxTokens, temperature })
    lines = parsePodcastScript(scriptRaw)
  }

  // Validate and retry once if quality is poor
  const { valid } = validateScript(lines, exchangeCount)
  if (!valid && _retryCount < 1) {
    return generateThemeScript(theme, analysis, themeIdx, markdown, signal, onLine, duration, themeContext, preset, _retryCount + 1)
  }

  return lines
}

// ─── Post-Processing: Deduplication ─────────────────────────────────────────

function deduplicateScript(lines: ScriptLine[]): ScriptLine[] {
  if (lines.length < 6) return lines

  const fillerPatterns = [
    /^that's (a )?(really )?(great|good|interesting|excellent|fascinating) (point|question|observation)/i,
    /^(it's|that's) (really )?(interesting|fascinating) (how|that|to)/i,
    /^(absolutely|exactly|definitely|certainly)[.!]?\s*$/i,
  ]

  // Count occurrences of each filler start
  const fillerCounts = new Map<string, number>()
  for (const line of lines) {
    for (const pattern of fillerPatterns) {
      if (pattern.test(line.text.trim())) {
        const key = line.text.trim().toLowerCase().slice(0, 30)
        fillerCounts.set(key, (fillerCounts.get(key) ?? 0) + 1)
      }
    }
  }

  // Track how many of each filler we've kept
  const fillerKept = new Map<string, number>()
  return lines.filter(line => {
    for (const pattern of fillerPatterns) {
      if (pattern.test(line.text.trim())) {
        const key = line.text.trim().toLowerCase().slice(0, 30)
        const total = fillerCounts.get(key) ?? 0
        if (total >= 3) {
          const kept = fillerKept.get(key) ?? 0
          if (kept >= 2) return false  // drop 3rd+ occurrence
          fillerKept.set(key, kept + 1)
        }
      }
    }
    return true
  })
}

// ─── Post-Processing: Transition Injection ──────────────────────────────────

function extractNoun(theme: string): string {
  // Extract the main noun/phrase from a theme title
  return theme.replace(/^(the|a|an)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').trim()
}

const transitionTemplates = [
  (prev: string, next: string) =>
    ({ speaker: 'B' as const, text: `Speaking of ${extractNoun(prev)}, that actually ties into ${extractNoun(next)}.` }),
  (prev: string, next: string) =>
    ({ speaker: 'B' as const, text: `So that covers ${extractNoun(prev)}. But I'm curious how ${extractNoun(next)} fits in.` }),
  (prev: string, next: string) =>
    ({ speaker: 'A' as const, text: `And building on what we just said about ${extractNoun(prev)}, let's look at ${extractNoun(next)}.` }),
]

function injectTransitions(themeResults: ScriptLine[][], themes: string[]): ScriptLine[] {
  const allLines: ScriptLine[] = []
  for (let i = 0; i < themeResults.length; i++) {
    allLines.push(...themeResults[i])
    if (i < themeResults.length - 1) {
      const template = transitionTemplates[i % transitionTemplates.length]
      allLines.push(template(themes[i], themes[i + 1]))
    }
  }
  return allLines
}

// ─── Post-Processing: Dramatize ─────────────────────────────────────────────

async function dramatizeScript(
  lines: ScriptLine[],
  signal?: AbortSignal,
): Promise<ScriptLine[]> {
  const chunkSize = 12
  const dramatized: ScriptLine[] = []

  for (let i = 0; i < lines.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const chunk = lines.slice(i, i + chunkSize)
    const chunkJson = JSON.stringify(chunk)

    const messages: ChatMessage[] = [
      { role: 'system', content: PROMPTS.podcastDramatize },
      { role: 'user', content: chunkJson },
    ]

    try {
      const result = await chatFast(messages, {
        signal,
        maxTokens: 1000,
        temperature: PROMPT_CONFIG.podcastDramatizeTemperature,
      })
      const parsed = parsePodcastScript(result)
      dramatized.push(...(parsed.length > 0 ? parsed : chunk))
    } catch {
      // On failure, keep original chunk
      dramatized.push(...chunk)
    }
  }

  return dramatized
}

// ─── Main Generation (streaming architecture) ────────────────────────────────

export type PodcastDuration = 'quick' | 'detailed'

export interface GenerateOptions {
  docId?: number
  scope?: 'single' | 'deep' | 'project'
  persona?: PodcastScript['persona']
  duration?: PodcastDuration
  /** Called after each theme completes — enables progressive playback */
  onLinesReady?: (lines: ScriptLine[]) => void
  /** Called per individual ScriptLine as LLM streams it — enables real-time TTS pre-synthesis */
  onLineStreamed?: (line: ScriptLine) => void
}

export async function generatePodcast(
  markdown: string,
  title: string,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
  options?: GenerateOptions,
): Promise<PodcastScript> {
  // Run storage budget in background — don't block generation start
  ensureStorageBudget().catch(() => {})

  const scope = options?.scope ?? 'single'
  const persona = options?.persona ?? 'overview'
  const duration = options?.duration ?? 'quick'
  const contentHash = await hashContent(markdown)

  // Check cache
  const allCached = await db.podcastScripts.where('contentHash').equals(contentHash).toArray()
  const cached = allCached.find((c) => {
    const s = c as unknown as PodcastScript & { duration?: string }
    return s.scope === scope && s.persona === persona && (s.duration ?? 'quick') === duration
  })
  if (cached) return cached as unknown as PodcastScript

  // ── Resolve device-adaptive preset once for the entire pipeline
  const preset = getPodcastPreset()
  const maxThemes = duration === 'detailed' ? preset.themesDetailed : preset.themesQuick

  // ── Phase 1: Extract themes + pre-warm Ollama in parallel
  onProgress?.('Extracting themes...', 10)

  let themes: string[]
  let analysis: DocumentAnalysis | undefined
  let analysisId: number | undefined

  const chunks = chunkMarkdown(markdown)

  // Pre-warm Ollama in background (ensures model loaded in VRAM before script calls)
  const warmup = prewarmOllama()

  // NOTE: analysis deferred to AFTER script generation (see Phase 3).
  // Running it here concurrently would double GPU/CPU load and cause browser hang.

  // Fast path: if markdown has 2+ H2/H3 headings, use them directly — skip LLM outline call
  const headings = chunks
    .filter(c => /^#{2,3}\s/.test(c.text))
    .map(c => c.text.replace(/^#{1,6}\s+/, '').trim())
    .filter(h => h.length > 3)
    .slice(0, maxThemes)

  if (headings.length >= 2) {
    themes = headings
  } else {
    // Slow path: LLM-based theme extraction
    const docSummary = chunks.map(c => c.text).join('\n\n').slice(0, PROMPT_CONFIG.podcastOutlineMaxInput)
    const outlineMessages: ChatMessage[] = [
      { role: 'system', content: PROMPTS.podcastOutline },
      { role: 'user', content: docSummary },
    ]
    const outlineRaw = await chatFast(outlineMessages, signal)
    themes = parsePodcastOutline(outlineRaw).slice(0, maxThemes)

    // Fallback: use any headings we can find
    if (themes.length === 0) {
      themes = headings.length > 0 ? headings : ['Overview of ' + title]
    }
  }

  // Ensure Ollama warm-up completed before script generation
  await warmup

  // ── Phase 2: Generate scripts per theme (adaptive to device tier)
  onProgress?.('Writing script...', 25)

  // Results array preserves theme order even with parallel execution
  const themeResults: ScriptLine[][] = new Array(themes.length)

  // Yield to the UI thread — prevents browser hang during heavy compute
  const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0))

  const useSequential = duration === 'detailed' && preset.enableSlidingWindow

  if (useSequential) {
    // Sequential with sliding window for cross-theme coherence
    let previousExchanges: ScriptLine[] = []
    for (let i = 0; i < themes.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await yieldToUI()

      const context: ThemeContext = {
        themes,
        currentIdx: i,
        previousExchanges: previousExchanges.length > 0 ? previousExchanges : undefined,
      }

      const lines = await generateThemeScript(
        themes[i], analysis, i, markdown, signal,
        options?.onLineStreamed, duration, context, preset,
      )
      themeResults[i] = lines
      previousExchanges = lines.slice(-2)

      // Notify with progress
      const currentLines: ScriptLine[] = []
      for (let j = 0; j <= i; j++) {
        if (themeResults[j]) currentLines.push(...themeResults[j])
      }
      options?.onLinesReady?.(currentLines)

      const pct = 25 + ((i + 1) / themes.length) * 50
      onProgress?.('Writing script...', Math.round(pct))
    }
  } else {
    // Parallel batches — batch size from device preset
    const BATCH_SIZE = preset.parallelBatchSize

    for (let batch = 0; batch < themes.length; batch += BATCH_SIZE) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await yieldToUI()

      const batchEnd = Math.min(batch + BATCH_SIZE, themes.length)
      const batchPromises = []
      for (let i = batch; i < batchEnd; i++) {
        const context: ThemeContext = { themes, currentIdx: i }
        batchPromises.push(
          generateThemeScript(themes[i], analysis, i, markdown, signal, options?.onLineStreamed, duration, context, preset)
            .then(lines => { themeResults[i] = lines })
        )
      }
      await Promise.all(batchPromises)

      const currentLines: ScriptLine[] = []
      for (let i = 0; i <= batchEnd - 1; i++) {
        if (themeResults[i]) currentLines.push(...themeResults[i])
      }
      options?.onLinesReady?.(currentLines)

      const pct = 25 + (batchEnd / themes.length) * 65
      onProgress?.('Writing script...', Math.round(pct))
    }
  }

  // ── Phase 3: Post-processing (features gated by device preset)
  onProgress?.('Polishing script...', 78)

  // Inject transitions between themes
  let allLines = preset.enableTransitions
    ? injectTransitions(themeResults, themes)
    : themeResults.flat()

  // Remove repetitive filler phrases
  if (preset.enableDeduplication) {
    allLines = deduplicateScript(allLines)
  }

  // Dramatize pass (adds naturalness: filler words, reactions)
  if (preset.enableDramatize && duration === 'detailed') {
    onProgress?.('Adding natural speech...', 85)
    allLines = await dramatizeScript(allLines, signal)
  }

  // ── Phase 4: Finalize + background analysis
  onProgress?.('Finalizing...', 92)

  // Start analysis NOW (after script gen done) — no GPU contention
  if (options?.docId !== undefined) {
    analyzeDocument(options.docId, markdown, contentHash).then(a => {
      analysis = a
      analysisId = a.id
    }).catch(() => { /* non-fatal */ })
  }

  const segments = buildPodcastSegments(allLines, title)
  const podcast: PodcastScript = {
    title,
    contentHash,
    analysisId,
    segments,
    scriptLines: allLines,
    scope,
    persona,
    sourceDocIds: options?.docId !== undefined ? [options.docId] : [],
    createdAt: Date.now(),
  }

  // Final notify with complete script
  options?.onLinesReady?.(allLines.slice())

  // Cache
  try {
    await db.podcastScripts.add(podcast as unknown as Parameters<typeof db.podcastScripts.add>[0])
  } catch { /* non-fatal */ }

  onProgress?.('Ready', 100)
  return podcast
}

// ─── Go Deeper (cross-doc) ───────────────────────────────────────────────────

export async function generateDeepPodcast(
  currentScript: PodcastScript,
  analysis: DocumentAnalysis,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<PodcastScript> {
  await ensureStorageBudget()

  onProgress?.('Loading related documents...', 10)

  const relatedDocIds = analysis.relatedDocIds.slice(0, 3)
  const currentThemeTitles = new Set(analysis.themes.map(t => t.title.toLowerCase()))

  const allNewLines: ScriptLine[] = []
  let processed = 0

  for (const relatedDocId of relatedDocIds) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const relatedDoc = await db.documents.get(relatedDocId)
    if (!relatedDoc) continue

    const relatedAnalysis = await db.documentAnalyses.where('docId').equals(relatedDocId).first()
    const uniqueThemes = relatedAnalysis?.themes.filter(
      t => !currentThemeTitles.has(t.title.toLowerCase())
    ) ?? []

    if (uniqueThemes.length === 0) continue

    const sourceText = relatedDoc.markdown.slice(0, PROMPT_CONFIG.podcastDeepMaxInput)
    const previousThemesSummary = analysis.themes.map(t => t.title).join(', ')

    const deepMessages: ChatMessage[] = [
      { role: 'system', content: PROMPTS.podcastDeep },
      { role: 'user', content: `Previously discussed: ${previousThemesSummary}\n\nNew material from "${relatedDoc.fileName}":\n${sourceText}` },
    ]

    const deepRaw = await chatFast(deepMessages, { signal, maxTokens: PROMPT_CONFIG.podcastMaxTokens })
    const newLines = parsePodcastScript(deepRaw)
    allNewLines.push(...newLines)

    processed++
    onProgress?.('Exploring related docs...', 10 + (processed / relatedDocIds.length) * 80)
  }

  if (allNewLines.length === 0) {
    throw new Error('No related content found to go deeper')
  }

  const bridgeSegment: PodcastSegment = {
    speaker: 'A',
    text: "Now let's look at some related documents.",
    rate: 1.0,
    pitch: 1.0,
    pauseBefore: 400,
  }

  const newSegments = buildPodcastSegments(allNewLines, currentScript.title)
  const contentSegments = newSegments.slice(1, -1)

  const deepScript: PodcastScript = {
    ...currentScript,
    scope: 'deep',
    segments: [...currentScript.segments.slice(0, -1), bridgeSegment, ...contentSegments, currentScript.segments[currentScript.segments.length - 1]],
    scriptLines: [...currentScript.scriptLines, ...allNewLines],
    sourceDocIds: [...currentScript.sourceDocIds, ...relatedDocIds.slice(0, processed)],
    createdAt: Date.now(),
  }

  try {
    await db.podcastScripts.add(deepScript as unknown as Parameters<typeof db.podcastScripts.add>[0])
  } catch { /* non-fatal */ }

  onProgress?.('Ready', 100)
  return deepScript
}
