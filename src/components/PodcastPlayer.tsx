import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Square, SkipForward, SkipBack, Mic, Loader2, ChevronDown, Sparkles, Volume2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { generatePodcast, generateDeepPodcast, buildPodcastSegments, type PodcastScript, type PodcastSegment, type PodcastDuration } from '../lib/podcast'
import { getAnalysisByDocId, getCachedAudio, cacheAudioSegment } from '../lib/docstore'
import type { DocumentAnalysis } from '../lib/docstore'
import { isKokoroReady, loadKokoro, synthesize, playPcm, getKokoroStatus, closeAudioContext } from '../lib/kokoro-tts'

type PlaybackState = 'idle' | 'generating' | 'playing' | 'paused'
type VoiceEngine = 'kokoro' | 'browser'

export function PodcastPlayer() {
  const markdown = useStore(s => s.markdown)
  const fileName = useStore(s => s.fileName)
  const activeDocId = useStore(s => s.activeDocId)
  const cachedScript = useStore(s => s.podcastScript)
  const setCachedScript = useStore(s => s.setPodcastScript)

  const [state, setState] = useState<PlaybackState>('idle')
  const [progress, setProgress] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const script = cachedScript
  const setScript = setCachedScript
  const [currentSegIdx, setCurrentSegIdx] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [showTranscript, setShowTranscript] = useState(false)
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null)
  const [canGoDeeper, setCanGoDeeper] = useState(false)
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>(() =>
    getKokoroStatus() === 'ready' ? 'kokoro' : 'browser'
  )
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [duration, setDuration] = useState<PodcastDuration>('quick')

  const synthRef = useRef(window.speechSynthesis)
  const abortRef = useRef<AbortController | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const playingRef = useRef(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Load voices with quality-based ranking
  useEffect(() => {
    const synth = synthRef.current
    const loadVoices = () => {
      const all = synth.getVoices().filter(v => v.lang.startsWith('en'))
      // Rank voices: neural/cloud voices score highest
      const scored = all.map(v => {
        let score = 0
        const name = v.name.toLowerCase()
        // Google's server-side voices (Chrome) — best quality
        if (name.includes('google')) score += 50
        // Microsoft neural voices (Edge) — excellent quality
        if (name.includes('microsoft') && (name.includes('online') || name.includes('natural'))) score += 45
        // Any voice with "natural" or "neural" keywords
        if (name.includes('natural')) score += 30
        if (name.includes('neural')) score += 30
        // Cloud/remote voices are generally higher quality
        if (!v.localService) score += 20
        // Prefer US/UK English for clarity
        if (v.lang === 'en-US') score += 5
        if (v.lang === 'en-GB') score += 3
        return { voice: v, score }
      })
      scored.sort((a, b) => b.score - a.score)
      voicesRef.current = scored.map(s => s.voice)
    }
    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)
    return () => synth.removeEventListener('voiceschanged', loadVoices)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    const synth = synthRef.current
    return () => {
      synth.cancel()
      abortRef.current?.abort()
      playingRef.current = false
    }
  }, [])

  // Auto-scroll transcript to current segment
  useEffect(() => {
    if (showTranscript && transcriptRef.current && state === 'playing') {
      const activeEl = transcriptRef.current.querySelector('[data-active="true"]')
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentSegIdx, showTranscript, state])

  const getVoiceForSpeaker = useCallback((speaker: 'A' | 'B'): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current
    if (voices.length === 0) return null

    // Alex (Host A) gets the top-ranked voice
    if (speaker === 'A') return voices[0]

    // Sam (Host B) gets a distinct voice — different name than Host A
    // Try to find a voice with a different gender/accent for contrast
    const hostA = voices[0]
    const distinct = voices.find(v =>
      v.name !== hostA.name && (
        // Prefer different accent (US vs UK)
        v.lang !== hostA.lang ||
        // Or different voice name entirely
        !v.name.toLowerCase().includes(hostA.name.toLowerCase().split(' ')[0])
      )
    )
    return distinct ?? (voices.length > 1 ? voices[1] : voices[0])
  }, [])

  // ─── Kokoro batched synthesis pipeline ─────────────────────────────────────
  // Pre-synthesize a batch of segments before playback starts, then keep
  // filling the buffer in the background while audio plays.

  const audioCache = useRef<Map<number, { audio: Float32Array; sampleRate: number }>>(new Map())
  const synthQueueRunning = useRef(false)

  // contentHash for audio cache key
  const contentHashRef = useRef('')

  /** Get audio for a segment: memory cache → IndexedDB cache → synthesize */
  const getAudio = useCallback(async (segment: PodcastSegment, idx: number): Promise<{ audio: Float32Array; sampleRate: number } | null> => {
    // 1. Memory cache (fastest)
    const mem = audioCache.current.get(idx)
    if (mem) return mem

    // 2. IndexedDB cache (instant replay — no re-synthesis)
    if (contentHashRef.current) {
      try {
        const dbCached = await getCachedAudio(contentHashRef.current, idx)
        if (dbCached) {
          const audio = new Float32Array(dbCached.pcm)
          const result = { audio, sampleRate: dbCached.sampleRate }
          audioCache.current.set(idx, result)
          return result
        }
      } catch { /* fall through to synthesis */ }
    }

    // 3. Synthesize (slowest — Web Worker)
    try {
      const result = await synthesize(segment.text, segment.speaker)
      audioCache.current.set(idx, result)
      // Save to IndexedDB for future replay (fire and forget)
      if (contentHashRef.current) {
        cacheAudioSegment(contentHashRef.current, idx, result.audio, result.sampleRate).catch(() => {})
      }
      return result
    } catch {
      return null
    }
  }, [])

  /** Pre-fill audio buffer. Parallel IndexedDB reads, sequential synthesis fallback. */
  const fillBuffer = useCallback(async (segments: PodcastSegment[], from: number, to: number) => {
    const end = Math.min(to, segments.length)
    const needed: number[] = []
    for (let i = from; i < end; i++) {
      if (!audioCache.current.has(i)) needed.push(i)
    }
    if (needed.length === 0) return // all in memory — instant

    // Parallel IndexedDB reads for all missing segments
    if (contentHashRef.current) {
      const dbReads = needed.map(async (i) => {
        try {
          const cached = await getCachedAudio(contentHashRef.current, i)
          if (cached) {
            audioCache.current.set(i, { audio: new Float32Array(cached.pcm), sampleRate: cached.sampleRate })
          }
        } catch { /* fall through to synthesis */ }
      })
      await Promise.all(dbReads)
    }

    // Synthesize anything still missing (sequential — ONNX is single-threaded)
    for (const i of needed) {
      if (!playingRef.current) break
      if (audioCache.current.has(i)) continue
      await getAudio(segments[i], i)
    }
  }, [getAudio])

  /** Background worker: continuously fills buffer ahead of playback */
  const startBufferWorker = useCallback((segments: PodcastSegment[]) => {
    if (synthQueueRunning.current) return
    synthQueueRunning.current = true

    const work = async () => {
      while (playingRef.current && synthQueueRunning.current) {
        let nextEmpty = -1
        for (let i = 0; i < segments.length; i++) {
          if (!audioCache.current.has(i)) { nextEmpty = i; break }
        }
        if (nextEmpty === -1) break // all cached

        await getAudio(segments[nextEmpty], nextEmpty)
        await new Promise(r => setTimeout(r, 10))
      }
      synthQueueRunning.current = false
    }
    work()
  }, [getAudio])

  /** Play a single segment from cache, waiting for it if needed */
  const playSegmentFromCache = useCallback(async (segment: PodcastSegment, idx: number): Promise<void> => {
    if (!playingRef.current) return

    const audioData = await getAudio(segment, idx)
    if (!audioData) return // skip segment
    audioCache.current.delete(idx) // free memory after use

    if (!playingRef.current) return

    // Pause between segments
    if (segment.pauseBefore > 0) {
      await new Promise(r => setTimeout(r, segment.pauseBefore))
    }

    if (!playingRef.current) return
    await playPcm(audioData.audio, audioData.sampleRate, segment.rate * speed)
  }, [speed])

  // ─── Browser TTS (Web Speech API) ──────────────────────────────────────────

  const speakSegmentBrowser = useCallback((segment: PodcastSegment): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!playingRef.current) { resolve(); return }

      const speak = () => {
        if (!playingRef.current) { resolve(); return }
        const utterance = new SpeechSynthesisUtterance(segment.text)
        utterance.rate = segment.rate * speed
        utterance.pitch = segment.pitch
        const voice = getVoiceForSpeaker(segment.speaker)
        if (voice) utterance.voice = voice
        utterance.onend = () => resolve()
        utterance.onerror = (e) => {
          if (e.error === 'canceled') resolve()
          else reject(e)
        }
        synthRef.current.speak(utterance)
      }

      if (segment.pauseBefore > 0) {
        setTimeout(speak, segment.pauseBefore)
      } else {
        speak()
      }
    })
  }, [speed, getVoiceForSpeaker])

  // ─── Unified playback ──────────────────────────────────────────────────────

  const INITIAL_BUFFER_SIZE = 8 // pre-synthesize first 8 segments before playing

  const playFrom = useCallback(async (startIdx: number) => {
    if (!script) return
    playingRef.current = true
    setState('playing')
    setShowTranscript(true)
    // Don't clear memory cache — IndexedDB getAudio() will repopulate it
    synthQueueRunning.current = false
    if (script.contentHash) contentHashRef.current = script.contentHash

    const useKokoro = voiceEngine === 'kokoro' && isKokoroReady()

    if (useKokoro) {
      // Phase 1: Pre-synthesize initial batch (blocks until ready)
      setProgress('Preparing audio...')
      const batchEnd = Math.min(startIdx + INITIAL_BUFFER_SIZE, script.segments.length)
      await fillBuffer(script.segments, startIdx, batchEnd)

      if (!playingRef.current) return

      // Phase 2: Start background worker to keep filling ahead
      startBufferWorker(script.segments)
      setProgress('')
    }

    // Phase 3: Play segments sequentially
    for (let i = startIdx; i < script.segments.length; i++) {
      if (!playingRef.current) break
      setCurrentSegIdx(i)

      if (useKokoro) {
        await playSegmentFromCache(script.segments[i], i)
      } else {
        await speakSegmentBrowser(script.segments[i])
      }
    }

    synthQueueRunning.current = false
    if (playingRef.current) {
      playingRef.current = false
      setState('idle')
      setCurrentSegIdx(0)
    }
  }, [script, voiceEngine, fillBuffer, startBufferWorker, playSegmentFromCache, speakSegmentBrowser])

  const handleGenerate = useCallback(async () => {
    if (!markdown) return
    setState('generating')
    abortRef.current = new AbortController()

    // DO NOT load Kokoro here — it competes with Gemma for GPU and causes browser hang.
    // Kokoro loads lazily when user presses Play (see handlePlay).

    try {
      const podcast = await generatePodcast(
        markdown,
        fileName ?? 'this document',
        (stage, pct) => { setProgress(stage); setProgressPct(pct) },
        abortRef.current.signal,
        {
          docId: activeDocId ?? undefined,
          duration,
          // Progressive playback: show Play button once we have enough content
          onLinesReady: (lines) => {
            const partialSegments = buildPodcastSegments(lines, fileName ?? 'document')
            if (partialSegments.length >= 4 && !script) {
              const partial: PodcastScript = {
                title: fileName ?? 'document',
                contentHash: '',
                segments: partialSegments,
                scriptLines: lines,
                scope: 'single',
                persona: 'overview',
                sourceDocIds: [],
                createdAt: Date.now(),
              }
              setScript(partial)
              setState('idle')
            }
          },
        }
      )
      setScript(podcast)
      contentHashRef.current = podcast.contentHash
      if (activeDocId) {
        const a = await getAnalysisByDocId(activeDocId)
        if (a && a.relatedDocIds.length > 0) {
          setAnalysis(a)
          setCanGoDeeper(true)
        }
      }
      setState('idle')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setState('idle')
      } else {
        setState('idle')
        console.error('Podcast generation failed:', err)
      }
    }
  }, [markdown, fileName, activeDocId, script, setScript, duration])

  const handlePlay = useCallback(() => {
    if (!script) {
      handleGenerate()
      return
    }
    // Lazy-load Kokoro on first Play — never during Generate (avoids GPU contention)
    if (getKokoroStatus() !== 'ready' && getKokoroStatus() !== 'loading') {
      setKokoroLoading(true)
      loadKokoro().then(() => {
        setVoiceEngine('kokoro')
        setKokoroLoading(false)
      }).catch(() => setKokoroLoading(false))
    }
    playFrom(state === 'paused' ? currentSegIdx : 0)
  }, [script, state, currentSegIdx, handleGenerate, playFrom])

  const handlePause = useCallback(() => {
    playingRef.current = false
    synthRef.current.cancel()
    setState('paused')
  }, [])

  const handleStop = useCallback(() => {
    playingRef.current = false
    synthQueueRunning.current = false
    synthRef.current.cancel()
    // Keep memory cache — instant replay without re-reading IndexedDB
    closeAudioContext()
    setState('idle')
    setCurrentSegIdx(0)
  }, [])

  const handleSkip = useCallback((delta: number) => {
    if (!script) return
    const next = Math.max(0, Math.min(script.segments.length - 1, currentSegIdx + delta))
    synthRef.current.cancel()
    playFrom(next)
  }, [script, currentSegIdx, playFrom])

  const speedOptions = [0.75, 1, 1.25, 1.5, 2]
  const progressPercent = script ? ((currentSegIdx + 1) / script.segments.length) * 100 : 0

  if (!markdown) return null

  // Pre-generation: show centered CTA
  if (!script && state !== 'generating') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 px-4">
        <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center">
          <Mic className="h-10 w-10 text-purple-400" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-gray-200">AI Podcast</h2>
          <p className="text-sm text-gray-400 max-w-md">
            Two AI hosts will discuss the key ideas in <span className="text-gray-300">{fileName ?? 'your document'}</span> — like listening to a conversation about what you're reading.
          </p>
        </div>
        {/* Duration selector */}
        <div className="flex items-center gap-1 p-1 bg-gray-800 rounded-full">
          <button
            onClick={() => setDuration('quick')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              duration === 'quick' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Quick (~2 min)
          </button>
          <button
            onClick={() => setDuration('detailed')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              duration === 'detailed' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Detailed (~10 min)
          </button>
        </div>
        <button
          onClick={handleGenerate}
          className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors text-sm font-medium"
        >
          <Sparkles className="h-4 w-4" />
          Generate Podcast
        </button>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>{duration === 'detailed' ? '~2-3 min' : '~30s'} to generate</span>
          <span>{duration === 'detailed' ? '~10-15 min' : '~2 min'} listen</span>
          <span>Powered by AI</span>
        </div>
      </div>
    )
  }

  // Generating state: show progress
  if (state === 'generating' && !script) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 px-4">
        <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center">
          <Loader2 className="h-10 w-10 text-purple-400 animate-spin" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-gray-200">{progress || 'Generating...'}</h2>
          <div className="w-64 h-1.5 bg-gray-700 rounded-full overflow-hidden mx-auto">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  // Player view: full-width immersive layout
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
          <Mic className="h-5 w-5 text-purple-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-gray-200 truncate">{fileName ?? 'Podcast'}</h2>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500">{script?.segments.length ?? 0} segments</p>
            {voiceEngine === 'kokoro' && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                <Volume2 className="h-2.5 w-2.5" />HD
              </span>
            )}
            {kokoroLoading && (
              <span className="text-[10px] text-gray-500">Loading HD voice...</span>
            )}
          </div>
        </div>
        {script && (
          <span className="ml-auto text-xs text-gray-500 tabular-nums">
            {currentSegIdx + 1} / {script.segments.length}
          </span>
        )}
      </div>

      {/* Progress bar — full width, clickable */}
      <div className="w-full h-1.5 bg-gray-700/50 rounded-full overflow-hidden mb-6 cursor-pointer"
        onClick={(e) => {
          if (!script) return
          const rect = e.currentTarget.getBoundingClientRect()
          const pct = (e.clientX - rect.left) / rect.width
          const idx = Math.floor(pct * script.segments.length)
          synthRef.current.cancel()
          playFrom(Math.max(0, Math.min(script.segments.length - 1, idx)))
        }}
      >
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Current speaker — large, prominent */}
      {(state === 'playing' || state === 'paused') && script && (
        <div className="mb-6 px-2">
          <div className="flex items-start gap-3">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
              script.segments[currentSegIdx]?.speaker === 'A'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {script.segments[currentSegIdx]?.speaker === 'A' ? 'Alex' : 'Sam'}
            </span>
            <p className="text-sm text-gray-300 leading-relaxed">
              {script.segments[currentSegIdx]?.text}
            </p>
          </div>
        </div>
      )}

      {/* Generation progress (when regenerating with existing script) */}
      {state === 'generating' && script && (
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{progress}</span>
          <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Controls — centered, prominent */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          onClick={() => handleSkip(-3)}
          disabled={state === 'generating' || !script}
          className="p-2 text-gray-400 hover:text-gray-200 disabled:opacity-20 transition-colors"
          title="Skip back"
        >
          <SkipBack className="h-5 w-5" />
        </button>

        {state === 'playing' ? (
          <button
            onClick={handlePause}
            className="p-4 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/20"
            title="Pause"
          >
            <Pause className="h-6 w-6" />
          </button>
        ) : (
          <button
            onClick={handlePlay}
            disabled={state === 'generating'}
            className="p-4 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:opacity-50 transition-colors shadow-lg shadow-purple-500/20"
            title={script ? 'Play' : 'Generate & Play'}
          >
            {state === 'generating' ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Play className="h-6 w-6" />
            )}
          </button>
        )}

        <button
          onClick={() => handleSkip(3)}
          disabled={state === 'generating' || !script}
          className="p-2 text-gray-400 hover:text-gray-200 disabled:opacity-20 transition-colors"
          title="Skip forward"
        >
          <SkipForward className="h-5 w-5" />
        </button>

        <button
          onClick={handleStop}
          disabled={state === 'idle' && currentSegIdx === 0}
          className="p-2 text-gray-400 hover:text-gray-200 disabled:opacity-20 transition-colors"
          title="Stop"
        >
          <Square className="h-4 w-4" />
        </button>
      </div>

      {/* Speed control */}
      <div className="flex items-center justify-center gap-1.5 mb-6">
        {speedOptions.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              speed === s
                ? 'bg-purple-500/20 text-purple-300 font-medium'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-center gap-3 mb-4">
        {script && (
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showTranscript ? 'rotate-180' : ''}`} />
            {showTranscript ? 'Hide' : 'Show'} transcript
          </button>
        )}

        {canGoDeeper && script && analysis && state !== 'generating' && (
          <button
            onClick={async () => {
              try {
                setState('generating')
                setProgress('Exploring related docs...')
                setProgressPct(0)
                const deep = await generateDeepPodcast(
                  script, analysis,
                  (stage, pct) => { setProgress(stage); setProgressPct(pct) }
                )
                setScript(deep)
                setCanGoDeeper(false)
                setState('idle')
              } catch {
                setState('idle')
              }
            }}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Go Deeper
          </button>
        )}
      </div>

      {/* Transcript — scrollable, with active speaking animation */}
      {showTranscript && script && (
        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto space-y-1.5 border-t border-gray-700/50 pt-4 min-h-0"
        >
          {script.scriptLines.map((line, i) => {
            // Map scriptLine index to segment index (offset by 1 for intro segment)
            const isActive = (state === 'playing' || state === 'paused') && i === currentSegIdx - 1
            const isPast = (state === 'playing' || state === 'paused') && i < currentSegIdx - 1
            const activeBorder = line.speaker === 'A' ? 'border-blue-400' : 'border-emerald-400'
            return (
              <div
                key={i}
                data-active={isActive}
                className={`flex gap-2 px-3 py-2 rounded-lg transition-all duration-300 cursor-pointer hover:bg-gray-800/50 border-l-2 ${
                  isActive
                    ? `bg-gray-800/80 ${activeBorder}`
                    : isPast
                      ? 'border-gray-700 opacity-50'
                      : 'border-transparent'
                }`}
                onClick={() => {
                  synthRef.current.cancel()
                  playFrom(i + 1) // +1 to skip intro segment
                }}
              >
                <span className={`text-xs font-bold shrink-0 mt-0.5 px-1.5 py-0.5 rounded transition-opacity ${
                  line.speaker === 'A'
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-emerald-400 bg-emerald-500/10'
                } ${isPast ? 'opacity-50' : ''}`}>
                  {line.speaker === 'A' ? 'Alex' : 'Sam'}
                  {isActive && state === 'playing' && (
                    <span className="inline-flex gap-0.5 ml-1 items-center">
                      <span className="w-0.5 h-2 bg-current rounded-full animate-[bounce_0.6s_ease-in-out_infinite]" />
                      <span className="w-0.5 h-3 bg-current rounded-full animate-[bounce_0.6s_ease-in-out_0.15s_infinite]" />
                      <span className="w-0.5 h-1.5 bg-current rounded-full animate-[bounce_0.6s_ease-in-out_0.3s_infinite]" />
                    </span>
                  )}
                </span>
                <span className={`text-sm leading-relaxed transition-colors ${
                  isActive ? 'text-gray-100 font-medium' : isPast ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  {line.text}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
