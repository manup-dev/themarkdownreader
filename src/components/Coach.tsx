import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { GraduationCap, ChevronLeft, ChevronRight, Loader2, CheckCircle2, XCircle, HelpCircle, Sparkles } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { chunkMarkdown } from '../lib/markdown'
import { generateCoachExplanation, generateQuiz, detectBestBackend, summarizeSection } from '../lib/ai'
import { trackEvent } from '../lib/telemetry'

interface QuizQuestion {
  question: string
  options: string[]
  correct: number
  explanation: string
}

export function CoachView() {
  const markdown = useStore((s) => s.markdown)
  const fileName = useStore((s) => s.fileName)
  const [sectionIndex, setSectionIndex] = useState(0)
  const [coaching, setCoaching] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<QuizQuestion[]>([])
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({})
  const [showExplanations, setShowExplanations] = useState(false)
  const [loadingCoach, setLoadingCoach] = useState(false)
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)
  const [sectionSummary, setSectionSummary] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState(false)
  const [simplified, setSimplified] = useState<string | null>(null)
  const [teachBack, setTeachBack] = useState<{input: string; feedback: string | null; loading: boolean}>({input: '', feedback: null, loading: false})
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [completedSections, setCompletedSections] = useState<Set<number>>(new Set())
  const [sectionScores, setSectionScores] = useState<Record<number, number>>(() => {
    const saved = localStorage.getItem('md-reader-coach-scores')
    return saved ? JSON.parse(saved) : {}
  })

  const chunks = useMemo(() => chunkMarkdown(markdown), [markdown])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    detectBestBackend().then((b) => setAiReady(b !== 'none'))
  }, [])

  // Reset state when section changes; auto-explain short sections
  useEffect(() => {
    setCoaching(null)
    setQuiz([])
    setSelectedAnswers({})
    setShowExplanations(false)
    setQuizError(null)
    setSectionSummary(null)
    setSimplified(null)
    setTeachBack({input: '', feedback: null, loading: false})
    setShowMoreActions(false)
  }, [sectionIndex])

  const currentChunk = chunks[sectionIndex]

  const handleCoach = useCallback(async () => {
    if (!currentChunk || loadingCoach) return
    setLoadingCoach(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const explanation = await generateCoachExplanation(
        currentChunk.text,
        fileName ?? 'Document',
        abortRef.current.signal,
      )
      setCoaching(explanation)
      setCompletedSections((prev) => new Set([...prev, sectionIndex]))
      trackEvent('ai_coach')
    } catch {
      setCoaching('Could not generate coaching. Make sure Ollama is running.')
    }
    setLoadingCoach(false)
  }, [currentChunk, fileName, loadingCoach, sectionIndex])

  const handleQuiz = useCallback(async () => {
    if (!currentChunk || loadingQuiz) return
    setLoadingQuiz(true)
    setQuizError(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setSelectedAnswers({})
    setShowExplanations(false)
    try {
      const questions = await generateQuiz(currentChunk.text, abortRef.current?.signal)
      if (!questions || questions.length === 0) {
        setQuiz([])
        setQuizError('Could not generate quiz questions for this section. Try a section with more content, or click again to retry.')
      } else {
        setQuiz(questions)
      }
    } catch {
      setQuiz([])
      setQuizError('Could not generate quiz. The AI model returned an invalid response. Try again or move to a different section.')
    }
    setLoadingQuiz(false)
  }, [currentChunk, loadingQuiz])

  // Auto-trigger explanation for very short sections (< 50 words)
  const autoExplainedRef = useRef<number>(-1)
  useEffect(() => {
    if (currentChunk && currentChunk.text.split(/\s+/).length < 50 && aiReady && !coaching && !loadingCoach && autoExplainedRef.current !== sectionIndex) {
      autoExplainedRef.current = sectionIndex
      handleCoach()
    }
  }, [sectionIndex, aiReady, currentChunk, coaching, loadingCoach, handleCoach])

  const selectAnswer = useCallback((qIndex: number, optionIndex: number) => {
    if (showExplanations) return
    setSelectedAnswers((prev) => ({ ...prev, [qIndex]: optionIndex }))
  }, [showExplanations])

  // Delight #33: Arrow key navigation in coach + quiz keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSectionIndex((i) => Math.min(chunks.length - 1, i + 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSectionIndex((i) => Math.max(0, i - 1))
      } else if (quiz.length > 0 && !showExplanations && ['1', '2', '3', '4'].includes(e.key)) {
        const optionIndex = parseInt(e.key) - 1
        if (optionIndex < (quiz[Object.keys(selectedAnswers).length]?.options.length ?? 0)) {
          selectAnswer(Object.keys(selectedAnswers).length, optionIndex)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [chunks.length, quiz, showExplanations, selectedAnswers, selectAnswer])

  const score = quiz.length > 0
    ? Object.entries(selectedAnswers).filter(([qi, ans]) => quiz[Number(qi)]?.correct === ans).length
    : 0

  const relatedSections = useMemo(() => {
    if (!currentChunk || chunks.length <= 3) return []
    const currentWords = new Set(currentChunk.text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [])
    return chunks
      .map((c, i) => {
        if (i === sectionIndex) return { i, score: -1 }
        const words = new Set(c.text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [])
        let overlap = 0
        for (const w of currentWords) { if (words.has(w)) overlap++ }
        return { i, score: overlap }
      })
      .filter((s) => s.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  }, [currentChunk, sectionIndex, chunks])

  if (!aiReady) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <GraduationCap className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300">Visual Coach</h3>
          <p className="text-gray-400 text-sm max-w-md">
            The coach needs Ollama to explain sections, create analogies, and quiz you.
            Make sure Ollama is running on localhost:11434.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Section Navigator */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSectionIndex(Math.max(0, sectionIndex - 1))}
            disabled={sectionIndex === 0}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            aria-label="Previous section"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <span className="text-xs text-gray-400 uppercase tracking-wider">
              Section {sectionIndex + 1} of {chunks.length}
              {completedSections.size > 0 && (
                <span className="ml-2 text-green-500">{completedSections.size} studied</span>
              )}
              {sectionScores[sectionIndex] !== undefined && (
                <span className={`ml-2 ${sectionScores[sectionIndex] >= 80 ? 'text-green-500' : sectionScores[sectionIndex] >= 50 ? 'text-amber-500' : 'text-red-400'}`}>
                  {sectionScores[sectionIndex]}% mastery
                </span>
              )}
              {(() => {
                const reviews = JSON.parse(localStorage.getItem('md-reader-coach-reviews') ?? '{}')
                const reviewTime = reviews[sectionIndex]
                if (reviewTime && Date.now() > reviewTime) {
                  return <span className="ml-2 text-purple-500 text-[10px]">due for review</span>
                }
                return null
              })()}
            </span>
            <span className="text-[9px] text-gray-400 block mt-0.5">← → to navigate</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-1">
              {currentChunk?.sectionPath ?? 'Document'}
            </h2>
          </div>
          <button
            onClick={() => setSectionIndex(Math.min(chunks.length - 1, sectionIndex + 1))}
            disabled={sectionIndex === chunks.length - 1}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            aria-label="Next section"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
            style={{ width: `${((sectionIndex + 1) / chunks.length) * 100}%` }}
          />
        </div>

        {/* Overall mastery */}
        {Object.keys(sectionScores).length > 0 && (
          <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400">
            <span>Overall mastery:</span>
            <span className={`font-semibold ${(() => {
              const avg = Math.round(Object.values(sectionScores).reduce((s, v) => s + v, 0) / Object.values(sectionScores).length)
              return avg >= 80 ? 'text-green-500' : avg >= 50 ? 'text-amber-500' : 'text-red-400'
            })()}`}>
              {Math.round(Object.values(sectionScores).reduce((s, v) => s + v, 0) / Object.values(sectionScores).length)}%
            </span>
            <span>({Object.keys(sectionScores).length} quizzed)</span>
          </div>
        )}

        {/* Section Content */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-base">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {currentChunk?.text ?? ''}
            </Markdown>
          </article>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 justify-center flex-wrap">
          <button
            onClick={handleCoach}
            disabled={loadingCoach}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all font-medium text-sm disabled:opacity-50"
          >
            {loadingCoach ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}
            Explain this section
          </button>
          <button
            onClick={handleQuiz}
            disabled={loadingQuiz}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all font-medium text-sm disabled:opacity-50"
          >
            {loadingQuiz ? <Loader2 className="h-4 w-4 animate-spin" /> : <HelpCircle className="h-4 w-4" />}
            Test my understanding
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreActions(!showMoreActions)}
              className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-all text-sm"
              aria-label="More actions"
            >
              More
              <ChevronRight className={`h-3 w-3 transition-transform ${showMoreActions ? 'rotate-90' : ''}`} />
            </button>
            {showMoreActions && (
              <div className="absolute top-full mt-1 right-0 sm:left-0 sm:right-auto z-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-1.5 min-w-[160px] animate-pop-in">
                <button
                  onClick={async () => { setShowMoreActions(false); if (!currentChunk) return; try { const s = await summarizeSection(currentChunk.text.slice(0, 1500)); setSectionSummary(s) } catch { /* AI unavailable */ } }}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5 text-green-500" /> Quick summary
                </button>
                <button
                  onClick={async () => { setShowMoreActions(false); if (!currentChunk) return; try { const { PROMPTS } = await import('../lib/prompts'); const { chat: chatFn } = await import('../lib/ai'); const result = await chatFn([{ role: 'system', content: PROMPTS.eli5 }, { role: 'user', content: currentChunk.text.slice(0, 1000) }]); setSimplified(result) } catch { /* AI unavailable */ } }}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <GraduationCap className="h-3.5 w-3.5 text-cyan-500" /> Simplify (ELI5)
                </button>
                <button
                  onClick={() => { setShowMoreActions(false); setTeachBack({input: '', feedback: null, loading: false}) }}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-pink-500" /> Teach back
                </button>
              </div>
            )}
          </div>
        </div>

        {quizError && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            {quizError}
          </div>
        )}

        {sectionSummary && (
          <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
            <p className="text-sm text-green-800 dark:text-green-200">{sectionSummary}</p>
          </div>
        )}

        {simplified && (
          <div className="bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="h-4 w-4 text-cyan-600" />
              <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Simplified Version</span>
            </div>
            <p className="text-sm text-cyan-800 dark:text-cyan-200">{simplified}</p>
          </div>
        )}

        {teachBack.input !== undefined && !teachBack.feedback && (
          <div className="bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-pink-700 dark:text-pink-300">Explain this section in your own words:</p>
            <textarea
              value={teachBack.input}
              onChange={(e) => setTeachBack(prev => ({...prev, input: e.target.value}))}
              placeholder="Write your explanation here..."
              className="w-full p-3 text-sm rounded-lg border border-pink-200 dark:border-pink-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-400 min-h-[80px]"
            />
            <button
              onClick={async () => {
                if (!teachBack.input.trim() || !currentChunk) return
                setTeachBack(prev => ({...prev, loading: true}))
                try {
                  const { chat: chatFn } = await import('../lib/ai')
                  const feedback = await chatFn([
                    { role: 'system', content: 'You are evaluating a student\'s explanation. Score 1-10 and give brief feedback (under 50 words). Format: "Score: X/10\nFeedback: ..."' },
                    { role: 'user', content: `Original text: ${currentChunk.text.slice(0, 500)}\n\nStudent explanation: ${teachBack.input}` },
                  ])
                  setTeachBack(prev => ({...prev, feedback, loading: false}))
                } catch {
                  setTeachBack(prev => ({...prev, feedback: 'Could not evaluate. Try again.', loading: false}))
                }
              }}
              disabled={!teachBack.input.trim() || teachBack.loading}
              className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 text-sm font-medium disabled:opacity-50"
            >
              {teachBack.loading ? 'Evaluating...' : 'Submit for feedback'}
            </button>
          </div>
        )}
        {teachBack.feedback && (
          <div className="bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800 rounded-xl p-4">
            <p className="text-sm text-pink-800 dark:text-pink-200 whitespace-pre-line">{teachBack.feedback}</p>
          </div>
        )}

        {/* Coach Explanation */}
        {coaching && (
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <GraduationCap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-800 dark:text-blue-300 text-sm">Your Coach</span>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-blue-900 dark:text-blue-100">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>{coaching}</Markdown>
            </div>
          </div>
        )}

        {/* Quiz */}
        {quiz.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold text-gray-800 dark:text-gray-200">Comprehension Check</h3>
            </div>

            {quiz.map((q, qi) => (
              <div key={qi} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-3">
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                  {qi + 1}. {q.question}
                </p>
                <div className="space-y-2">
                  {q.options.map((opt, oi) => {
                    const selected = selectedAnswers[qi] === oi
                    const isCorrect = q.correct === oi
                    const showResult = showExplanations

                    let borderClass = 'border-gray-200 dark:border-gray-700'
                    if (selected && !showResult) borderClass = 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    if (showResult && isCorrect) borderClass = 'border-green-500 bg-green-50 dark:bg-green-950/30'
                    if (showResult && selected && !isCorrect) borderClass = 'border-red-500 bg-red-50 dark:bg-red-950/30'

                    return (
                      <button
                        key={oi}
                        onClick={() => selectAnswer(qi, oi)}
                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-all ${borderClass} ${showResult ? 'cursor-default' : 'hover:border-blue-400 cursor-pointer'}`}
                      >
                        <span className="flex items-center gap-2">
                          {showResult && isCorrect && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                          {showResult && selected && !isCorrect && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                          <span className="text-gray-700 dark:text-gray-300">{opt}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {showExplanations && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-2 pl-2 border-l-2 border-gray-200 dark:border-gray-700">
                    {q.explanation}
                  </p>
                )}
              </div>
            ))}

            {!showExplanations && Object.keys(selectedAnswers).length === quiz.length && (
              <button
                onClick={() => {
                  setShowExplanations(true)
                  trackEvent('ai_quiz')
                  const pct = quiz.length > 0 ? Math.round((score / quiz.length) * 100) : 0
                  const updated = { ...sectionScores, [sectionIndex]: pct }
                  setSectionScores(updated)
                  localStorage.setItem('md-reader-coach-scores', JSON.stringify(updated))
                  // Spaced repetition: schedule review in 3 days
                  const reviews = JSON.parse(localStorage.getItem('md-reader-coach-reviews') ?? '{}')
                  reviews[sectionIndex] = Date.now() + 3 * 24 * 60 * 60 * 1000
                  localStorage.setItem('md-reader-coach-reviews', JSON.stringify(reviews))
                }}
                className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all font-medium"
              >
                Check Answers
              </button>
            )}

            {showExplanations && (
              <div className="text-center py-3">
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                  {score}/{quiz.length} correct
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {score === quiz.length ? 'Perfect! You nailed it.' : score >= quiz.length / 2 ? 'Good job! Review the explanations above.' : 'Keep going! Re-read the section and try again.'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${score === quiz.length ? 'bg-green-500' : score >= quiz.length / 2 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${quiz.length > 0 ? Math.round((score / quiz.length) * 100) : 0}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400">{quiz.length > 0 ? Math.round((score / quiz.length) * 100) : 0}% mastery</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Related sections — "backlinks" for readers */}
        {relatedSections.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Related sections</p>
            <div className="flex flex-wrap gap-1.5">
              {relatedSections.map((s) => (
                <button
                  key={s.i}
                  onClick={() => setSectionIndex(s.i)}
                  className="text-[10px] px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:text-blue-600 transition-colors truncate max-w-[200px]"
                  title={chunks[s.i].sectionPath}
                >
                  {chunks[s.i].sectionPath.split(' > ').pop()}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
