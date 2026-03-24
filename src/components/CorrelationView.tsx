import { useState, useEffect, useCallback } from 'react'
import { Link2, Loader2, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getCorrelations, explainCorrelation, type CorrelationResult } from '../lib/correlate'
import { detectBestBackend } from '../lib/ai'

export function CorrelationView() {
  const openDocument = useStore((s) => s.openDocument)
  const [correlations, setCorrelations] = useState<CorrelationResult[]>([])
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState(false)

  useEffect(() => {
    getCorrelations().then(setCorrelations)
    detectBestBackend().then((b) => setAiReady(b !== 'none'))
  }, [])

  const explain = useCallback(async (c: CorrelationResult) => {
    const key = `${c.docA}-${c.docB}`
    if (explanations[key]) return
    setLoadingKey(key)

    // Find documents by name
    const allDocs = await import('../lib/docstore').then((m) => m.getAllDocuments())
    const docA = allDocs.find((d) => d.fileName === c.docA)
    const docB = allDocs.find((d) => d.fileName === c.docB)

    if (docA && docB) {
      try {
        const exp = await explainCorrelation(docA, docB, c.sharedTerms)
        setExplanations((prev) => ({ ...prev, [key]: exp }))
      } catch {
        setExplanations((prev) => ({ ...prev, [key]: 'Failed to explain.' }))
      }
    }
    setLoadingKey(null)
  }, [explanations])

  const explainAll = useCallback(async () => {
    for (const c of correlations) {
      const key = `${c.docA}-${c.docB}`
      if (explanations[key]) continue
      await explain(c)
    }
  }, [correlations, explanations, explain])

  const handleOpenDoc = useCallback(async (fileName: string) => {
    const allDocs = await import('../lib/docstore').then((m) => m.getAllDocuments())
    const doc = allDocs.find((d) => d.fileName === fileName)
    if (doc) openDocument(doc.markdown, doc.fileName, doc.id!)
  }, [openDocument])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              Document Correlations
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Connections found across your document library based on shared themes
            </p>
          </div>
          {aiReady && correlations.length > 0 && (
            <button
              onClick={explainAll}
              disabled={loadingKey !== null}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 hover:bg-purple-100 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Explain all connections
            </button>
          )}
        </div>

        {correlations.length === 0 ? (
          <div className="text-center py-16">
            <Link2 className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No correlations found.</p>
            <p className="text-gray-400/60 text-xs mt-2">Upload 3+ documents with overlapping topics to discover connections.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {correlations.map((c) => {
              const key = `${c.docA}-${c.docB}`
              const pct = (c.strength * 100).toFixed(0)
              return (
                <div key={key} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-3">
                  {/* Header */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleOpenDoc(c.docA)}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[40%]"
                    >
                      {c.docA}
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="h-0.5 w-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded" />
                      <span className="text-xs font-bold text-purple-600 dark:text-purple-400 tabular-nums">{pct}%</span>
                      <div className="h-0.5 w-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded" />
                    </div>
                    <button
                      onClick={() => handleOpenDoc(c.docB)}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[40%]"
                    >
                      {c.docB}
                    </button>
                  </div>

                  {/* Shared terms */}
                  <div className="flex flex-wrap gap-1.5">
                    {c.sharedTerms.map((term) => (
                      <span key={term} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {term}
                      </span>
                    ))}
                  </div>

                  {/* AI explanation */}
                  {explanations[key] ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300 border-l-2 border-purple-300 dark:border-purple-700 pl-3">
                      {explanations[key]}
                    </p>
                  ) : aiReady ? (
                    <button
                      onClick={() => explain(c)}
                      disabled={loadingKey !== null}
                      className="inline-flex items-center gap-1 text-xs text-purple-500 hover:text-purple-700 disabled:opacity-50"
                    >
                      {loadingKey === key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Explain this connection
                    </button>
                  ) : null}

                  {/* Similarity bar */}
                  <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full"
                      style={{ width: `${Math.max(5, c.strength * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
