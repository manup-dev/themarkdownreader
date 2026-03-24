/**
 * Teacher-like, markdown-aware Text-to-Speech.
 * Reads documents like a knowledgeable narrator — announcing structure,
 * emphasizing key terms, describing non-text elements, guiding the listener.
 */

interface SpeechSegment {
  text: string
  rate?: number   // slower for headings, normal for body
  pitch?: number  // higher for headings
  pause?: number  // ms pause after this segment
}

export function markdownToSpeechSegments(markdown: string): SpeechSegment[][] {
  const parts = markdown.split(/(?=^#{1,6}\s)/m).filter((p) => p.trim())
  const totalSections = parts.filter((p) => /^#{1,6}\s/.test(p)).length

  return parts.map((section, sectionIdx) => {
    const segments: SpeechSegment[] = []
    const lines = section.split('\n')
    let isFirstSection = sectionIdx === 0
    let inCodeBlock = false

    for (const line of lines) {
      const trimmed = line.trim()

      // Track code block fences — skip all content inside
      if (trimmed.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true
          const lang = trimmed.replace(/```/, '').trim()
          segments.push({ text: lang ? `There's a ${lang} code example here.` : 'There\'s a code example here.', rate: 0.95, pause: 400 })
        } else {
          inCodeBlock = false
        }
        continue
      }
      if (inCodeBlock) continue
      if (!trimmed) continue

      // ── Headings: announce like a teacher ──
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/)
      if (headingMatch) {
        const level = headingMatch[1].length
        const title = cleanInline(headingMatch[2])
        const labels: Record<number, string> = {
          1: 'The document is titled',
          2: 'Next section:',
          3: 'Subsection:',
          4: 'Topic:',
          5: 'Note:',
          6: 'Detail:',
        }
        const label = labels[level] ?? 'Section:'

        if (level === 1 && isFirstSection) {
          segments.push({ text: `${label} "${title}".`, rate: 0.9, pitch: 1.1, pause: 800 })
          if (totalSections > 1) {
            segments.push({ text: `This document has ${totalSections} sections. Let's go through them.`, rate: 0.95, pause: 600 })
          }
        } else if (level <= 2) {
          segments.push({ text: `${label} "${title}".`, rate: 0.9, pitch: 1.05, pause: 700 })
        } else {
          segments.push({ text: `${label} ${title}.`, rate: 0.95, pause: 400 })
        }
        isFirstSection = false
        continue
      }

      // Code blocks handled above by inCodeBlock tracking

      // ── Horizontal rules ──
      if (/^[-*_]{3,}$/.test(trimmed)) {
        segments.push({ text: '', pause: 600 })
        continue
      }

      // ── Blockquotes ──
      if (trimmed.startsWith('>')) {
        const quoteText = cleanInline(trimmed.replace(/^>\s*/, ''))
        if (quoteText) {
          segments.push({ text: `Quote: "${quoteText}"`, rate: 0.9, pitch: 0.95, pause: 500 })
        }
        continue
      }

      // ── Tables: summarize ──
      if (trimmed.includes('|') && trimmed.startsWith('|')) {
        // Only announce table once (skip separator rows)
        if (!/^[\s|:-]+$/.test(trimmed)) {
          const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean)
          if (cells.length > 0) {
            segments.push({ text: cells.join(', ') + '.', rate: 0.95, pause: 300 })
          }
        }
        continue
      }

      // ── Unordered list items ──
      const ulMatch = trimmed.match(/^[-*+]\s+(.+)/)
      if (ulMatch) {
        const item = cleanInline(ulMatch[1])
        segments.push({ text: item, pause: 250 })
        continue
      }

      // ── Ordered list items ──
      const olMatch = trimmed.match(/^(\d+)\.\s+(.+)/)
      if (olMatch) {
        const item = cleanInline(olMatch[2])
        segments.push({ text: `${olMatch[1]}: ${item}`, pause: 300 })
        continue
      }

      // ── Images ──
      const imgMatch = trimmed.match(/!\[([^\]]*)\]\([^)]+\)/)
      if (imgMatch) {
        const alt = imgMatch[1]
        segments.push({ text: alt ? `There's an image showing: ${alt}.` : 'There\'s an image here.', pause: 400 })
        continue
      }

      // ── Regular paragraph ──
      const cleaned = cleanInline(trimmed)
      if (cleaned) {
        segments.push({ text: cleaned, pause: 200 })
      }
    }

    return segments
  })
}

/** Clean inline markdown to natural speech text */
function cleanInline(text: string): string {
  return text
    // Bold: emphasize by adding slight pause markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Italic
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Inline code: read naturally
    .replace(/`([^`]+)`/g, '$1')
    // Links: just the text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images inline
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // HTML tags
    .replace(/<[^>]+>/g, '')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim()
}

export interface TtsState {
  speaking: boolean
  paused: boolean
  currentSection: number
  currentSentence: number
  totalSections: number
  rate: number
  voice: SpeechSynthesisVoice | null
}

class MarkdownTts {
  private synth = typeof window !== 'undefined' ? window.speechSynthesis : null as unknown as SpeechSynthesis
  private sectionSegments: SpeechSegment[][] = []
  private currentSectionIdx = 0
  private currentSegmentIdx = 0
  private baseRate = 1.0
  private voice: SpeechSynthesisVoice | null = null
  private onStateChange: ((state: TtsState) => void) | null = null
  private stopped = false

  getVoices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices().filter((v) => v.lang.startsWith('en'))
  }

  setRate(rate: number) {
    this.baseRate = rate
  }

  setVoice(voice: SpeechSynthesisVoice | null) {
    this.voice = voice
  }

  onUpdate(cb: (state: TtsState) => void) {
    this.onStateChange = cb
  }

  private emitState(overrides: Partial<TtsState> = {}) {
    this.onStateChange?.({
      speaking: this.synth.speaking,
      paused: this.synth.paused,
      currentSection: this.currentSectionIdx,
      currentSentence: this.currentSegmentIdx,
      totalSections: this.sectionSegments.length,
      rate: this.baseRate,
      voice: this.voice,
      ...overrides,
    })
  }

  loadMarkdown(markdown: string) {
    this.sectionSegments = markdownToSpeechSegments(markdown)
    this.currentSectionIdx = 0
    this.currentSegmentIdx = 0
    this.stopped = false
  }

  async play(fromSection = 0) {
    this.stop()
    this.stopped = false
    this.currentSectionIdx = fromSection

    for (let i = fromSection; i < this.sectionSegments.length; i++) {
      if (this.stopped) break
      this.currentSectionIdx = i
      const segments = this.sectionSegments[i]

      // Transition between sections
      if (i > fromSection && segments.length > 0) {
        await this.sleep(500)
      }

      for (let j = 0; j < segments.length; j++) {
        if (this.stopped) break
        this.currentSegmentIdx = j
        this.emitState({ speaking: true })

        const seg = segments[j]
        if (seg.text) {
          await this.speakSegment(seg)
        }
        if (seg.pause) {
          await this.sleep(seg.pause)
        }
      }
    }

    // Outro
    if (!this.stopped) {
      await this.sleep(500)
      await this.speakSegment({ text: 'That\'s the end of the document.', rate: 0.9, pitch: 1.0 })
    }

    this.emitState({ speaking: false })
  }

  private speakSegment(seg: SpeechSegment): Promise<void> {
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(seg.text)
      utter.rate = (seg.rate ?? 1.0) * this.baseRate
      utter.pitch = seg.pitch ?? 1.0
      if (this.voice) utter.voice = this.voice
      // Chrome bug: onend may never fire for long utterances. Fallback timeout.
      const maxDuration = Math.max(15000, seg.text.length * 100) // ~100ms per char at 1x
      const timeout = setTimeout(() => resolve(), maxDuration)
      utter.onend = () => { clearTimeout(timeout); resolve() }
      utter.onerror = () => { clearTimeout(timeout); resolve() }
      this.synth.speak(utter)
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  pause() {
    this.synth.pause()
    this.emitState({ paused: true })
  }

  resume() {
    this.synth.resume()
    this.emitState({ paused: false })
  }

  stop() {
    this.stopped = true
    this.synth.cancel()
    this.emitState({ speaking: false, paused: false })
  }

  get sectionCount() {
    return this.sectionSegments.length
  }
}

export const tts = new MarkdownTts()
