import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { GraduationCap, ChevronLeft, ChevronRight, Loader2, CheckCircle2, XCircle, HelpCircle, Sparkles } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { chunkMarkdown } from '../lib/markdown'
import { generateCoachExplanation, generateQuiz, detectBestBackend } from '../lib/ai'

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
  const [aiReady, setAiReady] = useState(false)
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
  useEffect(() => {
    if (currentChunk && currentChunk.text.split(/\s+/).length < 50 && aiReady && !coaching && !loadingCoach) {
      handleCoach()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIndex, aiReady])

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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-1">
              {currentChunk?.sectionPath ?? 'Document'}
            </h2>
          </div>
          <button
            onClick={() => setSectionIndex(Math.min(chunks.length - 1, sectionIndex + 1))}
            disabled={sectionIndex === chunks.length - 1}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-400"
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

        {/* Section Content */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-base">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {currentChunk?.text ?? ''}
            </Markdown>
          </article>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 justify-center">
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
        </div>

        {quizError && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            {quizError}
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
                  const pct = Math.round((score / quiz.length) * 100)
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
