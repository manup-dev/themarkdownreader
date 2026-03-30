import { useState, useEffect, useCallback } from 'react'
import { Clock, FileText, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { buildSectionCards, type SectionCard } from '../lib/visualize'
import { summarizeSection, detectBestBackend } from '../lib/ai'

const SUMMARY_STOP_WORDS = new Set(['this','that','with','from','have','been','will','your','they','their','which','when','what','each','other','about','more','than','also','only','into','some','very','just','like','over','such','most','these','there','could','would','should'])

export function SummaryCardsView() {
  const markdown = useStore((s) => s.markdown)
  const toc = useStore((s) => s.toc)
  const setViewMode = useStore((s) => s.setViewMode)
  const [cards, setCards] = useState<SectionCard[]>([])
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState(false)

  useEffect(() => {
    const built = buildSectionCards(markdown, toc)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCards(built)
    detectBestBackend().then((b) => setAiReady(b !== 'none'))
  }, [markdown, toc])

  const generateSummary = useCallback(async (card: SectionCard) => {
    setLoadingId(card.id)
    try {
      const summary = await summarizeSection(card.text.slice(0, 2000))
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, summary } : c)),
      )
    } catch {
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, summary: 'Failed to generate summary.' } : c)),
      )
    }
    setLoadingId(null)
  }, [])

  const generateAll = useCallback(async () => {
    for (const card of cards) {
      if (card.summary) continue
      setLoadingId(card.id)
      try {
        const summary = await summarizeSection(card.text.slice(0, 2000))
        setCards((prev) =>
          prev.map((c) => (c.id === card.id ? { ...c, summary } : c)),
        )
      } catch {
        setCards((prev) =>
          prev.map((c) => (c.id === card.id ? { ...c, summary: 'Failed to generate summary.' } : c)),
        )
      }
    }
    setLoadingId(null)
  }, [cards])

  const navigateToSection = (id: string) => {
    setViewMode('read')
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Document Overview
            {cards.length > 0 && <span className="text-sm font-normal text-gray-400 ml-2">{cards.length} sections</span>}
          </h2>
          {aiReady && (
            <button
              onClick={generateAll}
              disabled={loadingId !== null}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              Summarize all sections
            </button>
          )}
        </div>

        {cards.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(() => {
              const allText = cards.map((c) => c.text).join(' ').toLowerCase()
              const words = allText.match(/\b[a-z]{4,}\b/g) ?? []
              const freq = new Map<string, number>()
              const stop = SUMMARY_STOP_WORDS
              for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1) }
              const top = [...freq.entries()].filter(([,c]) => c >= 2).sort((a,b) => b[1]-a[1]).slice(0, 12)
              if (top.length === 0) return null
              const max = top[0][1]
              return top.map(([word, count]) => (
                <span key={word} className="text-blue-500/60 dark:text-blue-400/60 font-medium" style={{ fontSize: `${Math.max(10, Math.round(10 + (count / max) * 8))}px` }}>{word}</span>
              ))
            })()}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-min">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
            <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-3">Document Stats</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(() => {
                const totalWords = cards.reduce((s, c) => s + c.wordCount, 0)
                const totalMins = Math.max(1, Math.ceil(totalWords / 230))
                const codeBlocks = Math.floor((markdown.match(/```/g) ?? []).length / 2)
                const tables = (markdown.match(/^\|[-:| ]+\|$/gm) ?? []).length
                const links = (markdown.match(/\[([^\]]+)\]\([^)]+\)/g) ?? []).length
                const images = (markdown.match(/!\[/g) ?? []).length
                return [
                  { label: 'Words', value: totalWords.toLocaleString() },
                  { label: 'Reading time', value: `${totalMins} min` },
                  { label: 'Sections', value: String(cards.length) },
                  { label: 'Code blocks', value: String(codeBlocks) },
                  { label: 'Tables', value: String(tables) },
                  { label: 'Links', value: String(links) },
                  ...(images > 0 ? [{ label: 'Images', value: String(images) }] : []),
                ].map((stat) => (
                  <div key={stat.label} className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{stat.label}</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{stat.value}</span>
                  </div>
                ))
              })()}
            </div>
          </div>
          {(() => { const totalWordsAll = cards.reduce((s, c) => s + c.wordCount, 0); return cards.map((card) => (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => expandedId === card.id ? setExpandedId(null) : setExpandedId(card.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === card.id ? null : card.id) } }}
              className={`bg-white dark:bg-gray-900 border rounded-xl p-5 cursor-pointer hover:shadow-md transition-all group ${
                expandedId === card.id ? 'border-blue-400 dark:border-blue-600 shadow-md col-span-1 md:col-span-2 lg:col-span-3' : 'border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700'
              }`}
            >
              <h3 className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-2 line-clamp-2">
                {card.title}
              </h3>

              {card.summary ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3">
                  {card.summary}
                </p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-3 line-clamp-3 italic">
                  {card.text
                    .replace(/^#+\s+.+\n/gm, '')
                    .replace(/\*\*(.+?)\*\*/g, '$1')
                    .replace(/\*(.+?)\*/g, '$1')
                    .replace(/`([^`]+)`/g, '$1')
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                    .replace(/^[-*+]\s+/gm, '')
                    .replace(/^\d+\.\s+/gm, '')
                    .replace(/^>\s+/gm, '')
                    .replace(/\|[^|]*\|/g, '')
                    .replace(/^---+$/gm, '')
                    .replace(/\n{2,}/g, ' ')
                    .trim()
                    .slice(0, 150)}...
                </p>
              )}

              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {card.wordCount} words
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {card.readingTime} min
                </span>
                <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ml-2">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((card.wordCount / Math.max(1, totalWordsAll)) * 100)}%` }} />
                </div>
                {aiReady && !card.summary && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      generateSummary(card)
                    }}
                    disabled={loadingId !== null}
                    className="ml-auto text-blue-500 hover:text-blue-700 disabled:opacity-50"
                    title="AI summarize this section"
                  >
                    {loadingId === card.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
              {expandedId === card.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800">
                  {card.summary ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{card.summary}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic mb-3">Click the sparkle icon to generate an AI summary.</p>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); navigateToSection(card.id) }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Jump to section &rarr;
                  </button>
                </div>
              )}
            </div>
          )); })()}
        </div>

        {cards.length === 0 && (
          <p className="text-center text-gray-400 py-12">
            No top-level sections found in this document.
          </p>
        )}
      </div>
    </div>
  )
}
