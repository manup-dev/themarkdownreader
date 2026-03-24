import { useState, useCallback } from 'react'
import { Sun, Moon, BookOpen, Minus, Plus, X, BookText, Network, LayoutGrid, TreePine, GraduationCap, GitBranch, Library, ArrowLeft, Save, Check, Settings, Contrast, Type, Maximize, Printer } from 'lucide-react'
import { AiSettings } from './AiSettings'
import { useStore, type Theme, type ViewMode } from '../store/useStore'
import { addDocument } from '../lib/docstore'
import { getActiveBackend } from '../lib/ai'

const singleDocModes: { value: ViewMode; icon: React.ReactNode; label: string; tooltip: string }[] = [
  { value: 'read', icon: <BookText className="h-3.5 w-3.5" />, label: 'Read', tooltip: 'Distraction-free reading' },
  { value: 'summary-cards', icon: <LayoutGrid className="h-3.5 w-3.5" />, label: 'Cards', tooltip: 'Summary cards with key points per section' },
  { value: 'mindmap', icon: <GitBranch className="h-3.5 w-3.5" />, label: 'Mind Map', tooltip: 'Visual outline of document structure' },
  { value: 'treemap', icon: <TreePine className="h-3.5 w-3.5" />, label: 'Treemap', tooltip: 'Section sizes as proportional blocks' },
  { value: 'knowledge-graph', icon: <Network className="h-3.5 w-3.5" />, label: 'Graph', tooltip: 'AI-extracted concepts and relationships' },
  { value: 'coach', icon: <GraduationCap className="h-3.5 w-3.5" />, label: 'Coach', tooltip: 'AI explains sections + comprehension quizzes' },
]

export function Toolbar() {
  const theme = useStore((s) => s.theme)
  const fontSize = useStore((s) => s.fontSize)
  const readingProgress = useStore((s) => s.readingProgress)
  const fileName = useStore((s) => s.fileName)
  const viewMode = useStore((s) => s.viewMode)
  const workspaceMode = useStore((s) => s.workspaceMode)
  const markdown = useStore((s) => s.markdown)
  const activeDocId = useStore((s) => s.activeDocId)
  const setTheme = useStore((s) => s.setTheme)
  const setFontSize = useStore((s) => s.setFontSize)
  const setViewMode = useStore((s) => s.setViewMode)
  const setFileName = useStore((s) => s.setFileName)
  const setActiveDocId = useStore((s) => s.setActiveDocId)
  const reset = useStore((s) => s.reset)
  const backToWorkspace = useStore((s) => s.backToWorkspace)
  const backToCollection = useStore((s) => s.backToCollection)
  const fromCollection = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('md-reader-from-collection') === '1'

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [aiBackend, setAiBackend] = useState<string>(() => getActiveBackend())

  const dyslexicFont = useStore((s) => s.dyslexicFont)
  const setDyslexicFont = useStore((s) => s.setDyslexicFont)

  const themes: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <Sun className="h-4 w-4" />, label: 'Light' },
    { value: 'dark', icon: <Moon className="h-4 w-4" />, label: 'Dark' },
    { value: 'sepia', icon: <BookOpen className="h-4 w-4" />, label: 'Sepia' },
    { value: 'high-contrast', icon: <Contrast className="h-4 w-4" />, label: 'High Contrast' },
  ]

  const isWorkspaceView = viewMode === 'workspace' || viewMode === 'cross-doc-graph' || viewMode === 'correlation' || viewMode === 'similarity-map' || viewMode === 'collection'
  const showDocTabs = markdown && !isWorkspaceView

  const handleRename = useCallback(() => {
    const newName = nameInput.trim()
    if (newName && newName !== fileName) {
      setFileName(newName.endsWith('.md') ? newName : newName + '.md')
    }
    setEditingName(false)
  }, [nameInput, fileName, setFileName])

  const handleSave = useCallback(async () => {
    if (!markdown || !fileName) return
    const result = await addDocument(fileName, markdown)
    setActiveDocId(result.docId)
    setSaved(true)
    setTimeout(() => setSaved(false), 3500)
  }, [markdown, fileName, setActiveDocId])

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
      {/* Top row */}
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left */}
        <div className="flex items-center gap-2 min-w-0">
          {(workspaceMode || fromCollection) && markdown && (
            <button
              onClick={() => {
                sessionStorage.removeItem('md-reader-from-collection')
                fromCollection ? backToCollection() : backToWorkspace()
              }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              title={fromCollection ? 'Back to collection' : 'Back to library'}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          {/* Editable filename */}
          {editingName ? (
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditingName(false) }}
              className="text-sm font-medium px-2 py-0.5 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none w-48"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setNameInput(fileName ?? 'untitled.md'); setEditingName(true) }}
              className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-48 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="Click to rename"
            >
              {isWorkspaceView ? 'Document Library' : fileName ?? 'Document'}
            </button>
          )}

          {!isWorkspaceView && markdown && (
            <>
              <span
                className="text-xs text-gray-400 tabular-nums cursor-default"
                title={`${Math.round(readingProgress)}% read`}
              >
                {Math.round(readingProgress)}%
              </span>

              {/* Save to library button */}
              {!activeDocId && (
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors"
                  title="Save to library for later reading"
                >
                  <Save className="h-3 w-3" />
                  Save
                </button>
              )}
              {saved && (
                <span className="inline-flex items-center gap-1 text-xs text-green-500">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
            </>
          )}
        </div>

        {/* Center: theme toggle */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={(e) => { setTheme(t.value); const el = e.currentTarget; el.style.transform = 'scale(1.2)'; setTimeout(() => { el.style.transform = '' }, 200) }}
              className={`p-1.5 rounded-md transition-all ${
                theme === t.value
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title={t.label}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {viewMode === 'read' && markdown && (
            <>
              <button
                onClick={() => setFontSize(Math.max(14, fontSize - 2))}
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Decrease font size"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="text-xs text-gray-400 tabular-nums w-8 text-center">{fontSize}</span>
              <button
                onClick={() => setFontSize(Math.min(28, fontSize + 2))}
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Increase font size"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDyslexicFont(!dyslexicFont)}
                className={`p-1.5 transition-colors rounded-md ${dyslexicFont ? 'text-blue-600 bg-blue-50 dark:bg-blue-950/40' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                title={dyslexicFont ? 'Disable dyslexia-friendly font' : 'Enable dyslexia-friendly font'}
              >
                <Type className="h-4 w-4" />
              </button>
              <button
                onClick={() => document.documentElement.querySelector('.flex.h-screen')?.classList.toggle('focus-mode')}
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                title="Focus mode (Ctrl+Shift+F)"
                aria-label="Focus mode"
              >
                <Maximize className="h-4 w-4" />
              </button>
              <button
                onClick={() => document.documentElement.querySelector('.flex.h-screen')?.classList.toggle('zen-mode')}
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                title="Zen mode — minimal reading"
                aria-label="Zen mode"
              >
                <span className="text-xs font-medium">Z</span>
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
            </>
          )}
          <button
            onClick={() => window.print()}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title="Print / Export PDF (p)"
            aria-label="Print document"
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <span className="text-xs font-bold w-4 h-4 flex items-center justify-center">?</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors relative"
            title="AI Settings"
          >
            <Settings className="h-4 w-4" />
            <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
              aiBackend === 'ollama' || aiBackend === 'openrouter' ? 'bg-green-500' : aiBackend === 'webllm' ? 'bg-blue-500' : 'bg-red-400'
            }`} title={`AI: ${aiBackend}`} />
          </button>
          {!isWorkspaceView && (
            <button
              onClick={() => {
                if (!workspaceMode && !activeDocId && markdown) {
                  if (!window.confirm('Close without saving to library?')) return
                }
                if (workspaceMode) { backToWorkspace() } else { reset(); window.location.hash = '' }
              }}
              className="p-1.5 text-gray-500 hover:text-red-500 transition-colors"
              title={workspaceMode ? 'Back to library' : 'Close document'}
            >
              {workspaceMode ? <Library className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* AI Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => { setShowSettings(false); setAiBackend(getActiveBackend()) }}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <AiSettings onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}

      {/* View mode tabs */}
      {showDocTabs && (
        <div className="flex items-center gap-1 px-4 pb-2 overflow-x-auto" style={{ maskImage: 'linear-gradient(to right, black 90%, transparent)', WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent)' }}>
          {singleDocModes.map((vm) => (
            <button
              key={vm.value}
              onClick={() => setViewMode(vm.value)}
              title={vm.tooltip}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === vm.value
                  ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {vm.icon}
              {vm.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
