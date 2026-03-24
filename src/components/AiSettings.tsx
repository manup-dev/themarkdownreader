import { useState, useEffect, useCallback } from 'react'
import { Key, Server, Zap, Check, X, Eye, EyeOff, ExternalLink, Settings } from 'lucide-react'
import { setApiKey, getApiKey, clearApiKey, detectBestBackend, getActiveBackend, checkOllamaHealth } from '../lib/ai'

// Use same key as ai.ts to avoid duplication
const LS_OLLAMA_URL = 'md-reader-ollama-url'

type Backend = 'openrouter' | 'ollama' | 'webllm' | 'none'

const backendMeta: Record<Backend, { label: string; color: string }> = {
  openrouter: { label: 'OpenRouter', color: 'bg-purple-500' },
  ollama: { label: 'Ollama', color: 'bg-green-500' },
  webllm: { label: 'WebLLM', color: 'bg-blue-500' },
  none: { label: 'None', color: 'bg-neutral-500' },
}

export function AiSettings({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKeyState] = useState(() => getApiKey() ?? '')
  const [showKey, setShowKey] = useState(false)
  const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem(LS_OLLAMA_URL) ?? import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434')
  const [activeBackend, setActiveBackend] = useState<Backend>(() => (getActiveBackend() as Backend) ?? 'none')
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    checkOllamaHealth().then(setOllamaReachable)
    detectBestBackend().then((b) => setActiveBackend(b as Backend))
  }, [])

  const handleTestConnection = useCallback(async () => {
    if (!apiKey.trim() || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(5000),
      })
      setTestResult(res.ok ? 'success' : 'error')
    } catch {
      setTestResult('error')
    }
    setTesting(false)
  }, [apiKey, testing])

  const handleSave = useCallback(() => {
    const trimmedKey = apiKey.trim()
    if (trimmedKey) {
      setApiKey(trimmedKey)
    } else {
      clearApiKey()
    }
    localStorage.setItem(LS_OLLAMA_URL, ollamaUrl.trim() || 'http://localhost:11434')
    onClose()
  }, [apiKey, ollamaUrl, onClose])

  const meta = backendMeta[activeBackend] ?? backendMeta.none

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-gray-400" />
          <span className="font-semibold text-gray-800 dark:text-gray-200">AI Settings</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Active:</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${meta.color}`}>
            <Zap className="h-3 w-3" />
            {meta.label}
          </span>
        </div>
      </div>

      <hr className="border-gray-200 dark:border-gray-700" />

      {/* OpenRouter API Key */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
          <Key className="h-3.5 w-3.5" />
          OpenRouter API Key
        </label>
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => { setApiKeyState(e.target.value); setTestResult(null) }}
              placeholder="sk-or-..."
              autoFocus
              className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 pr-8 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-300"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={!apiKey.trim() || testing}
            className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-purple-400" />
            ) : testResult === 'success' ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : testResult === 'error' ? (
              <X className="h-3.5 w-3.5 text-red-400" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Test
          </button>
        </div>
        {testResult === 'success' && (
          <p className="text-xs text-green-400">API key is valid.</p>
        )}
        {testResult === 'error' && (
          <p className="text-xs text-red-400">Invalid key or network error.</p>
        )}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
        >
          Get free API key
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <hr className="border-gray-200 dark:border-gray-700" />

      {/* Ollama */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
          <Server className="h-3.5 w-3.5" />
          Ollama
        </label>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              ollamaReachable === null ? 'bg-neutral-500' : ollamaReachable ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {ollamaReachable === null
              ? 'Checking...'
              : ollamaReachable
                ? 'Reachable'
                : 'Unreachable'}
          </span>
        </div>
        <input
          type="text"
          value={ollamaUrl}
          onChange={(e) => setOllamaUrl(e.target.value)}
          placeholder="http://localhost:11434"
          className={`w-full rounded-md border bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none ${
            ollamaUrl && !ollamaUrl.match(/^https?:\/\/.+/) ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700 focus:border-green-500 focus:ring-1 focus:ring-green-500'
          }`}
        />
        {ollamaUrl && !ollamaUrl.match(/^https?:\/\/.+/) && (
          <p className="text-[10px] text-red-400">URL must start with http:// or https://</p>
        )}
        <button
          type="button"
          onClick={async () => {
            setOllamaReachable(null)
            const ok = await checkOllamaHealth()
            setOllamaReachable(ok)
          }}
          disabled={!ollamaUrl.match(/^https?:\/\/.+/)}
          className="self-start rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
        >
          Re-check
        </button>
      </div>

      <hr className="border-gray-200 dark:border-gray-700" />

      {/* Save & Close */}
      <button
        type="button"
        onClick={handleSave}
        className="flex items-center justify-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
      >
        <Check className="h-3.5 w-3.5" />
        Save &amp; Close
      </button>
    </div>
  )
}
