import { chatFast, checkOllamaHealth, getActiveBackend, getOllamaBaseUrl, type ChatMessage } from './ai'
import { chunkMarkdown } from './markdown'
import { PROMPTS, PROMPT_CONFIG } from './prompts'
import { db, searchAcrossDocuments, type DocumentAnalysis, type AnalyzedChunk } from './docstore'
import { analyzeDocument } from './analysis'
import { ensureStorageBudget } from './storage-manager'

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

// ─── Theme Script Generation (single theme) ─────────────────────────────────

async function generateThemeScript(
  theme: string,
  analysis: DocumentAnalysis | undefined,
  themeIdx: number,
  markdown: string,
  signal?: AbortSignal,
  onLine?: (line: ScriptLine) => void,
  duration: PodcastDuration = 'quick',
): Promise<ScriptLine[]> {
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

  const exchangeCount = duration === 'detailed' ? PROMPT_CONFIG.podcastExchangesDetailed : PROMPT_CONFIG.podcastExchangesQuick
  const maxTokens = duration === 'detailed' ? PROMPT_CONFIG.podcastDetailedMaxTokens : PROMPT_CONFIG.podcastMaxTokens
  const promptTemplate = duration === 'detailed' ? PROMPTS.podcastScriptDetailed : PROMPTS.podcastScript
  const prompt = promptTemplate.replace('{{EXCHANGE_COUNT}}', String(exchangeCount))

  const scriptMessages: ChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: `Theme: ${theme}\n\nSource material:\n${relevantText}` },
  ]

  // If streaming callback provided, use incremental parsing for real-time TTS
  if (onLine) {
    const parser = new IncrementalScriptParser(onLine)
    const scriptRaw = await chatFast(scriptMessages, {
      signal,
      maxTokens,
      onToken: (token) => parser.push(token),
    })
    // Flush any remaining lines not caught by incremental parsing
    const remaining = parser.flush()
    const all = parsePodcastScript(scriptRaw)
    if (remaining.length > 0 && all.length > remaining.length) {
      return all
    }
    return all.length > 0 ? all : remaining
  }

  const scriptRaw = await chatFast(scriptMessages, { signal, maxTokens })
  return parsePodcastScript(scriptRaw)
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
    .slice(0, duration === 'detailed' ? PROMPT_CONFIG.podcastThemesDetailed : PROMPT_CONFIG.podcastThemesQuick)

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
    themes = parsePodcastOutline(outlineRaw)

    // Fallback: use any headings we can find
    if (themes.length === 0) {
      themes = headings.length > 0 ? headings : ['Overview of ' + title]
    }
  }

  // Ensure Ollama warm-up completed before script generation
  await warmup

  // ── Phase 2: Generate scripts per theme (parallel batches — notify after each batch)
  onProgress?.('Writing script...', 25)

  const allLines: ScriptLine[] = []
  // Results array preserves theme order even with parallel execution
  const themeResults: ScriptLine[][] = new Array(themes.length)

  // Parallel batching: only when using server-side backends (Ollama/OpenRouter).
  // In-browser inference can't parallelize — concurrent calls compete for GPU/CPU.
  const backend = getActiveBackend()
  const canParallelize = backend === 'ollama' || backend === 'openrouter'
  const BATCH_SIZE = canParallelize ? 2 : 1

  // Yield to the UI thread — prevents browser hang during heavy compute
  const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0))

  for (let batch = 0; batch < themes.length; batch += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // Yield before each batch so React can paint progress updates
    await yieldToUI()

    const batchEnd = Math.min(batch + BATCH_SIZE, themes.length)
    const batchPromises = []
    for (let i = batch; i < batchEnd; i++) {
      batchPromises.push(
        generateThemeScript(themes[i], analysis, i, markdown, signal, options?.onLineStreamed, duration)
          .then(lines => { themeResults[i] = lines })
      )
    }
    await Promise.all(batchPromises)

    // Rebuild allLines in order from completed results, notify player
    allLines.length = 0
    for (let i = 0; i <= batchEnd - 1; i++) {
      if (themeResults[i]) allLines.push(...themeResults[i])
    }
    options?.onLinesReady?.(allLines.slice())

    const pct = 25 + (batchEnd / themes.length) * 65
    onProgress?.('Writing script...', Math.round(pct))
  }

  // ── Phase 3: Finalize + background analysis
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
