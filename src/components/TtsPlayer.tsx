import { useState, useEffect, useCallback } from 'react'
import { Play, Pause, Square, SkipForward, SkipBack, Volume2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { tts, type TtsState } from '../lib/tts'

export function TtsPlayer() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const toc = useStore((s) => s.toc)
  const setTtsPlaying = useStore((s) => s.setTtsPlaying)
  const setTtsSectionIndex = useStore((s) => s.setTtsSectionIndex)

  const [state, setState] = useState<TtsState>({
    speaking: false,
    paused: false,
    currentSection: 0,
    currentSentence: 0,
    totalSections: 0,
    rate: 1.0,
    voice: null,
  })
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    tts.loadMarkdown(markdown)
    tts.onUpdate((s) => {
      setState(s)
      setTtsPlaying(s.speaking)
      setTtsSectionIndex(s.currentSection)
    })

    // Load voices
    const loadVoices = () => setVoices(tts.getVoices())
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices

    return () => { tts.stop() }
  }, [markdown, setTtsPlaying, setTtsSectionIndex])

  const handlePlay = useCallback(() => {
    if (state.paused) {
      tts.resume()
    } else {
      tts.play(state.currentSection)
    }
  }, [state])

  const handlePause = useCallback(() => { tts.pause() }, [])
  const handleStop = useCallback(() => { tts.stop() }, [])

  const handlePrev = useCallback(() => {
    const prev = Math.max(0, state.currentSection - 1)
    tts.stop()
    setTimeout(() => tts.play(prev), 100)
  }, [state])

  const handleNext = useCallback(() => {
    const next = Math.min(tts.sectionCount - 1, state.currentSection + 1)
    tts.stop()
    setTimeout(() => tts.play(next), 100)
  }, [state])

  const handleRateChange = useCallback((rate: number) => {
    tts.setRate(rate)
    setState((s) => ({ ...s, rate }))
  }, [])

  const handleVoiceChange = useCallback((voiceURI: string) => {
    const voice = voices.find((v) => v.voiceURI === voiceURI) ?? null
    tts.setVoice(voice)
    setState((s) => ({ ...s, voice }))
  }, [voices])

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        onDoubleClick={() => { setExpanded(true); setTimeout(() => handlePlay(), 100) }}
        className={`fixed bottom-6 left-6 p-3 rounded-full shadow-lg transition-all z-20 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${
          theme === 'sepia'
            ? 'bg-amber-700 text-white hover:bg-amber-800 hover:scale-110'
            : 'bg-emerald-600 text-white hover:bg-emerald-700 hover:scale-110'
        }`}
        title="Click to expand, double-click to start reading"
      >
        <Volume2 className="h-5 w-5" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 left-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl p-4 z-20 w-80">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Read Aloud
        </span>
        <button
          onClick={() => { tts.stop(); setExpanded(false) }}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="Collapse player"
        >
          Close
        </button>
      </div>

      {/* Progress + time remaining */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Section {state.currentSection + 1}/{tts.sectionCount}{toc[state.currentSection] ? ` — ${toc[state.currentSection].text}` : ''}</span>
          <span>
            {tts.sectionCount > 0 && (() => {
              const remaining = tts.sectionCount - state.currentSection - 1
              const minsLeft = Math.max(1, Math.ceil(remaining * 0.5 / state.rate))
              return remaining > 0 ? `~${minsLeft}m left` : 'Almost done'
            })()}
          </span>
        </div>
        <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded-full">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: tts.sectionCount > 0 ? `${((state.currentSection + 1) / tts.sectionCount) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <button onClick={handlePrev} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <SkipBack className="h-4 w-4" />
        </button>
        {state.speaking && !state.paused ? (
          <button onClick={handlePause} className="p-3 bg-emerald-600 text-white rounded-full hover:bg-emerald-700">
            <Pause className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={handlePlay} className="p-3 bg-emerald-600 text-white rounded-full hover:bg-emerald-700">
            <Play className="h-5 w-5" />
          </button>
        )}
        <button onClick={handleStop} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <Square className="h-4 w-4" />
        </button>
        <button onClick={handleNext} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <SkipForward className="h-4 w-4" />
        </button>
      </div>

      {/* Speed presets */}
      <div className="flex items-center gap-1 mb-2">
        <span className="text-xs text-gray-400 w-10">Speed</span>
        {[0.75, 1, 1.25, 1.5, 2].map((r) => (
          <button
            key={r}
            onClick={() => handleRateChange(r)}
            title={`${r}x = ~${Math.round(230 * r)} words/min`}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
              state.rate === r
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {r}x
          </button>
        ))}
      </div>

      {/* Voice selector */}
      {voices.length > 0 && (
        <select
          value={state.voice?.voiceURI ?? ''}
          onChange={(e) => handleVoiceChange(e.target.value)}
          className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
