import { chatFast, checkOllamaHealth, getOllamaBaseUrl, type ChatMessage } from './ai'

/** Podcast uses a larger model for better dialogue quality (more exchanges, less repetition). */
const PODCAST_MODEL = 'gemma3:4b'
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
        model: PODCAST_MODEL,
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
  // Strip Qwen3-style thinking tags before parsing
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fenced = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) return fenced[1].trim()
  const bracketStart = cleaned.indexOf('[')
  const bracketEnd = cleaned.lastIndexOf(']')
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    return cleaned.slice(bracketStart, bracketEnd + 1)
  }
  // Truncation repair: if we have `[` but no `]`, try to close the array
  // by finding the last complete object and appending `]`
  if (bracketStart !== -1 && bracketEnd <= bracketStart) {
    const partial = cleaned.slice(bracketStart)
    const lastObjEnd = partial.lastIndexOf('}')
    if (lastObjEnd > 0) {
      // Trim trailing comma if present, then close array
      const trimmed = partial.slice(0, lastObjEnd + 1).replace(/,\s*$/, '')
      return trimmed + ']'
    }
  }
  return cleaned
}

/** Safe repairs: normalize smart quotes that LLMs use as JSON delimiters. */
function repairJsonSmartQuotes(raw: string): string {
  // Left/right double smart quotes → straight double quotes
  // Gemma3 and others sometimes close JSON strings with U+201D
  let s = raw.replace(/[\u201C\u201D]/g, '"')
  // Remove trailing commas in arrays/objects
  s = s.replace(/,\s*([}\]])/g, '$1')
  return s
}

/** Aggressive repairs: convert Python-style JSON (single-quoted). May damage text content with apostrophes. */
function repairJsonAggressive(raw: string): string {
  let s = repairJsonSmartQuotes(raw)
  // Smart apostrophes → straight
  s = s.replace(/[\u2018\u2019]/g, "'")
  // Single-quoted strings → double-quoted (Python-style fallback)
  s = s.replace(/(?<=[{[,:])\s*'([^']*?)'\s*(?=[,}\]:])/g, '"$1"')
  s = s.replace(/{\s*(\w+)\s*:/g, '{"$1":')
  s = s.replace(/,\s*(\w+)\s*:/g, ',"$1":')
  return s
}

export function parsePodcastOutline(raw: string): string[] {
  const json = extractJson(raw)
  for (const attempt of [json, repairJsonSmartQuotes(json), repairJsonAggressive(json)]) {
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

/** Strip markdown artifacts that LLMs sometimes inject into dialogue text */
function cleanDialogueText(text: string): string {
  return text
    .replace(/\*+([^*]+)\*+/g, '$1')   // *emphasis* or **bold**
    .replace(/`([^`]+)`/g, '$1')        // `code`
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [link](url)
    .replace(/#{1,6}\s+/g, '')          // ### headings
    .trim()
}

export function parsePodcastScript(raw: string): ScriptLine[] {
  const json = extractJson(raw)
  for (const attempt of [json, repairJsonSmartQuotes(json), repairJsonAggressive(json)]) {
    try {
      const parsed = JSON.parse(attempt)
      if (!Array.isArray(parsed)) continue
      const lines = parsed.filter(
        (item): item is ScriptLine =>
          item && (item.speaker === 'A' || item.speaker === 'B') && typeof item.text === 'string'
      ).map(item => ({ ...item, text: cleanDialogueText(item.text) }))
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

  let prevSpeaker: 'A' | 'B' | null = null
  for (const line of script) {
    const isSwitching = prevSpeaker !== null && prevSpeaker !== line.speaker
    const isShortReaction = line.text.split(/\s+/).length <= 5
    const rateJitter = (Math.random() - 0.5) * 0.1
    const pitchJitter = (Math.random() - 0.5) * 0.1
    const pause = prevSpeaker === null ? 0
      : isShortReaction ? 50 + Math.random() * 50
      : isSwitching ? 80 + Math.random() * 120
      : 60 + Math.random() * 80

    segments.push({
      speaker: line.speaker,
      text: sanitizeForSpeech(line.text),
      rate: (line.speaker === 'A' ? 1.0 : 1.05) + rateJitter,
      pitch: (line.speaker === 'A' ? 1.0 : 1.1) + pitchJitter,
      pauseBefore: Math.round(pause),
    })
    prevSpeaker = line.speaker
  }

  // Fallback: if script is empty, add a minimal intro/outro
  if (segments.length === 0) {
    segments.push({ speaker: 'A', text: `Let's talk about ${title}.`, rate: 1.0, pitch: 1.0, pauseBefore: 0 })
    segments.push({ speaker: 'A', text: `That's ${title}.`, rate: 1.0, pitch: 1.0, pauseBefore: 300 })
  }

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
 *
 * Optimized: only runs regex when a closing `}` is detected (cheap char check),
 * and scans only from the last parse offset — avoids O(buffer²) rescanning.
 */
class IncrementalScriptParser {
  private buffer = ''
  private emittedCount = 0
  private parseOffset = 0
  private onLine: (line: ScriptLine) => void
  private pendingParse = false

  constructor(onLine: (line: ScriptLine) => void) {
    this.onLine = onLine
  }

  push(token: string): void {
    this.buffer += token
    // Cheap check: only schedule parse if token contains object-closing char
    if (token.includes('}') && !this.pendingParse) {
      this.pendingParse = true
      // Batch with microtask to coalesce rapid token arrivals
      queueMicrotask(() => {
        this.pendingParse = false
        this._tryParse()
      })
    }
  }

  /** Return any remaining lines not yet emitted */
  flush(): ScriptLine[] {
    this._tryParse() // Final sync parse
    const all = parsePodcastScript(this.buffer)
    return all.slice(this.emittedCount)
  }

  private _tryParse(): void {
    // Scan only the new portion of the buffer since last parse
    const searchRegion = this.buffer.slice(this.parseOffset)
    const objRegex = /\{\s*"speaker"\s*:\s*"([AB])"\s*,\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"\s*\}/g
    let match: RegExpExecArray | null
    while ((match = objRegex.exec(searchRegion)) !== null) {
      this.emittedCount++
      // Advance parse offset past this match so we never rescan it
      this.parseOffset += match.index + match[0].length
      const text = cleanDialogueText(
        match[2].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\')
      )
      this.onLine({ speaker: match[1] as 'A' | 'B', text })
      // Reset regex for the remaining slice
      break // Re-enter loop with updated offset on next push
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
  /** Extractive summary of previous theme (first + last Alex line) for richer context */
  previousSummary?: string
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
  exchangeOverride?: number,
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

  const exchangeCount = exchangeOverride ?? (duration === 'detailed' ? p.exchangesPerThemeDetailed : p.exchangesPerThemeQuick)
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

  // Sliding window: include summary + last 2 exchanges from previous theme for continuity
  if (themeContext?.previousExchanges && themeContext.previousExchanges.length > 0) {
    if (themeContext.previousSummary) {
      userContent += `Previous topic summary: ${themeContext.previousSummary}\n`
    }
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
  const repeatPenalty = 1.15

  // If streaming callback provided, use incremental parsing for real-time TTS
  let lines: ScriptLine[]
  if (onLine) {
    const parser = new IncrementalScriptParser(onLine)
    const scriptRaw = await chatFast(scriptMessages, {
      signal,
      maxTokens,
      temperature,
      repeatPenalty,
      model: PODCAST_MODEL,
      onToken: (token) => parser.push(token),
    })
    // Flush any remaining lines not caught by incremental parsing
    const remaining = parser.flush()
    const all = parsePodcastScript(scriptRaw)
    lines = (remaining.length > 0 && all.length > remaining.length) ? all : (all.length > 0 ? all : remaining)
  } else {
    const scriptRaw = await chatFast(scriptMessages, { signal, maxTokens, temperature, repeatPenalty, model: PODCAST_MODEL })
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
  (prev: string, next: string) =>
    ({ speaker: 'B' as const, text: `Okay so we've got a good handle on ${extractNoun(prev)}. What about ${extractNoun(next)} though?` }),
  (prev: string, next: string) =>
    ({ speaker: 'A' as const, text: `That's a nice segue actually, because ${extractNoun(next)} builds directly on ${extractNoun(prev)}.` }),
  (prev: string, next: string) =>
    ({ speaker: 'B' as const, text: `Wait, before we move on from ${extractNoun(prev)}, doesn't that connect to ${extractNoun(next)}?` }),
  (_prev: string, next: string) =>
    ({ speaker: 'A' as const, text: `Right, and that brings us to something related. Let's talk about ${extractNoun(next)}.` }),
  (prev: string, next: string) =>
    ({ speaker: 'B' as const, text: `I keep thinking about how ${extractNoun(prev)} relates to ${extractNoun(next)}. Can we dig into that?` }),
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
        model: PODCAST_MODEL,
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

// ─── Exchange Budget Distribution ───────────────────────────────────────────

/**
 * Distribute exchange budgets proportionally to source material richness.
 * Rich themes get more depth, thin themes don't pad with filler.
 */
function distributeExchanges(
  sourceLengths: number[],
  basePerTheme: number,
  minPerTheme = 4,
  maxPerTheme = 12,
): number[] {
  if (sourceLengths.length <= 1) return sourceLengths.map(() => basePerTheme)

  const totalLength = sourceLengths.reduce((a, b) => a + b, 0)
  if (totalLength === 0) return sourceLengths.map(() => basePerTheme)

  const totalBudget = basePerTheme * sourceLengths.length
  return sourceLengths.map(len => {
    const raw = Math.round(totalBudget * (len / totalLength))
    // Round to nearest even number for clean A/B alternation
    const even = Math.round(raw / 2) * 2
    return Math.max(minPerTheme, Math.min(maxPerTheme, even))
  })
}

// ─── Hook & Synthesis Generation ────────────────────────────────────────────

async function generateHookOrSynthesis(
  type: 'hook' | 'synthesis',
  title: string,
  themes: string[],
  sourcePreview: string,
  signal?: AbortSignal,
): Promise<ScriptLine[]> {
  const prompt = type === 'hook' ? PROMPTS.podcastHook : PROMPTS.podcastSynthesis
  const userContent = type === 'hook'
    ? `Topic: ${title}\n\nKey themes: ${themes.join(', ')}\n\nSource excerpt:\n${sourcePreview}`
    : `Topic: ${title}\n\nThemes discussed: ${themes.join(', ')}`

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: userContent },
  ]

  try {
    const raw = await chatFast(messages, {
      signal,
      maxTokens: 300,
      temperature: 0.5,
      model: PODCAST_MODEL,
    })
    const lines = parsePodcastScript(raw)
    return lines.length > 0 ? lines.slice(0, 2) : []
  } catch {
    return [] // Non-fatal — falls back to template intro/outro
  }
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

  // Start document analysis in parallel — it's CPU-only (TF-IDF, chunk annotation, no LLM)
  // so it won't contend with Ollama GPU. Completing before script gen enables
  // analysis-powered source retrieval instead of keyword fallback.
  const analysisPromise = options?.docId !== undefined
    ? analyzeDocument(options.docId, markdown, contentHash).catch(() => undefined)
    : Promise.resolve(undefined)

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
    const outlineRaw = await chatFast(outlineMessages, { signal, model: PODCAST_MODEL })
    themes = parsePodcastOutline(outlineRaw).slice(0, maxThemes)

    // Fallback: use any headings we can find
    if (themes.length === 0) {
      themes = headings.length > 0 ? headings : ['Overview of ' + title]
    }
  }

  // Ensure Ollama warm-up and analysis completed before script generation
  const [, analysisResult] = await Promise.all([warmup, analysisPromise])
  if (analysisResult) {
    analysis = analysisResult
    analysisId = analysisResult.id
  }

  // ── Phase 1b: Distribute exchange budgets by source richness
  const baseExchanges = duration === 'detailed' ? preset.exchangesPerThemeDetailed : preset.exchangesPerThemeQuick
  const themeSourceLengths = themes.map(theme => {
    const themeWords = theme.toLowerCase().split(/\s+/)
    return chunks
      .map(c => ({ text: c.text, score: themeWords.filter(w => c.text.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .reduce((sum, r) => sum + r.text.length, 0)
  })
  const exchangeBudgets = distributeExchanges(themeSourceLengths, baseExchanges)

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
    let previousSummary: string | undefined
    for (let i = 0; i < themes.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await yieldToUI()

      const context: ThemeContext = {
        themes,
        currentIdx: i,
        previousExchanges: previousExchanges.length > 0 ? previousExchanges : undefined,
        previousSummary,
      }

      const lines = await generateThemeScript(
        themes[i], analysis, i, markdown, signal,
        options?.onLineStreamed, duration, context, preset,
        0, exchangeBudgets[i],
      )
      themeResults[i] = lines
      previousExchanges = lines.slice(-2)
      // Extract summary: first and last Alex lines from this theme
      const alexLines = lines.filter(l => l.speaker === 'A')
      if (alexLines.length >= 2) {
        previousSummary = `${alexLines[0].text} ... ${alexLines[alexLines.length - 1].text}`
      } else if (alexLines.length === 1) {
        previousSummary = alexLines[0].text
      }

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
          generateThemeScript(themes[i], analysis, i, markdown, signal, options?.onLineStreamed, duration, context, preset, 0, exchangeBudgets[i])
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

  // Dramatize pass — adds naturalness (self-corrections, analogies, varied rhythm).
  // Run for detailed mode always, and for quick mode when script is short enough to be cheap.
  const shouldDramatize = preset.enableDramatize && (duration === 'detailed' || allLines.length <= 20)
  if (shouldDramatize) {
    onProgress?.('Adding natural speech...', 85)
    allLines = await dramatizeScript(allLines, signal)
  }

  // ── Phase 3b: Generate hook + synthesis (replace template intro/outro)
  onProgress?.('Adding hook and synthesis...', 90)

  const sourcePreview = chunks.map(c => c.text).join('\n').slice(0, 500)
  const [hookLines, synthLines] = await Promise.all([
    generateHookOrSynthesis('hook', title, themes, sourcePreview, signal),
    generateHookOrSynthesis('synthesis', title, themes, sourcePreview, signal),
  ])

  if (hookLines.length > 0) allLines.unshift(...hookLines)
  if (synthLines.length > 0) allLines.push(...synthLines)

  // ── Phase 4: Finalize
  onProgress?.('Finalizing...', 95)

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

    const deepRaw = await chatFast(deepMessages, { signal, maxTokens: PROMPT_CONFIG.podcastMaxTokens, model: PODCAST_MODEL })
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
