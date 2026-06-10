import { Cloud, Cpu, Zap } from 'lucide-react'

// Cross-component signal to open the AI Settings modal, which lives as local
// state in Toolbar.tsx. Same pattern as 'md-reader-highlight-changed'.
export const OPEN_AI_SETTINGS_EVENT = 'md-reader-open-ai-settings'

export function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_AI_SETTINGS_EVENT))
}

/**
 * Empty-state shown wherever an AI feature is blocked because backend
 * detection landed on 'none' (no Ollama, no WebGPU, no key) — the default
 * for Safari/Firefox/mobile visitors. One primary action: free cloud setup.
 */
export function AiSetupPrompt({ feature }: { feature: string }) {
  return (
    <div className="text-center space-y-3 max-w-sm mx-auto py-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {feature} needs an AI backend. Set one up in under a minute — pick whichever fits:
      </p>
      <button
        onClick={openAiSettings}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Cloud className="h-4 w-4" />
        Set up free cloud AI (~30s)
      </button>
      <p className="text-xs text-gray-400">
        Paste a free key from openrouter.ai — no card required.
      </p>
      <div className="text-xs text-gray-400 space-y-1 text-left mx-auto w-fit">
        <p className="flex items-center gap-1.5"><Zap className="h-3 w-3 shrink-0" /> Or use a WebGPU browser (Chrome/Edge) for fully-local AI</p>
        <p className="flex items-center gap-1.5"><Cpu className="h-3 w-3 shrink-0" /> Or run Ollama on your machine — auto-detected</p>
      </div>
    </div>
  )
}
