import { useState, useEffect } from 'react'
import { Brain } from 'lucide-react'
import { onModelProgress, getModelState } from '../lib/inference/model-manager'
import type { ModelState } from '../lib/inference/model-manager'

export function AiLoadingIndicator() {
  const [state, setState] = useState<ModelState>(getModelState)

  useEffect(() => {
    return onModelProgress(setState)
  }, [])

  if (state.status === 'idle' || state.status === 'ready') return null

  if (state.status === 'failed') {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
        <Brain className="h-3 w-3" />
        <span>AI unavailable</span>
      </div>
    )
  }

  const pct = Math.round(state.progress * 100)

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] text-blue-400">
      <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-300/30 border-t-blue-400" />
      <span className="max-w-[120px] truncate">{state.progressText || 'Loading AI...'}</span>
      <span className="font-mono tabular-nums">{pct}%</span>
      <div className="h-1 w-16 rounded-full bg-blue-500/20 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
