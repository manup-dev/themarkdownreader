import { useState, useCallback, useEffect, useRef } from 'react'
import { Sun, Moon, BookOpen, Minus, Plus, X, BookText, TreePine, GraduationCap, GitBranch, Library, ArrowLeft, Save, Check, Settings, Contrast, Type, Maximize, Printer, Palette, SlidersHorizontal, ChevronDown } from 'lucide-react'
import { AiSettings } from './AiSettings'
import { useStore, type Theme, type ViewMode } from '../store/useStore'
import { addDocument } from '../lib/docstore'
import { getActiveBackend } from '../lib/ai'
import { trackEvent } from '../lib/telemetry'

const singleDocModes: { value: ViewMode; icon: React.ReactNode; label: string; tooltip: string }[] = [
  { value: 'read', icon: <BookText className="h-3.5 w-3.5" />, label: 'Read', tooltip: 'Distraction-free reading' },
  { value: 'mindmap', icon: <GitBranch className="h-3.5 w-3.5" />, label: 'Mind Map', tooltip: 'Visual outline of document structure' },
  { value: 'treemap', icon: <TreePine className="h-3.5 w-3.5" />, label: 'Treemap', tooltip: 'Section sizes as proportional blocks' },
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
  const [showAppearance, setShowAppearance] = useState(false)
  const [showMode, setShowMode] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const appearanceRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

  const viewShortcuts: Record<string, string> = { read: 'Ctrl+1', mindmap: 'Ctrl+2', 'summary-cards': 'Ctrl+3', treemap: 'Ctrl+4' }

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

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showAppearance && appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) {
        setShowAppearance(false)
      }
      if (showMode && modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setShowMode(false)
      }
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
        setAiBackend(getActiveBackend())
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAppearance, showMode, showSettings])

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

  const doClose = useCallback(() => {
    setShowCloseConfirm(false)
    if (workspaceMode) { backToWorkspace() } else {
      const state = useStore.getState()
      const wordsRead = Math.round(state.markdown.split(/\s+/).length * (state.readingProgress / 100))
      const sessionMins = parseInt(localStorage.getItem('md-reader-session-start') ?? '0')
      const elapsed = sessionMins > 0 ? Math.round((Date.now() - sessionMins) / 60000) : 0
      if (state.readingProgress > 10 && elapsed > 0) {
        const msg = `Session: ${wordsRead.toLocaleString()} words read (${Math.round(state.readingProgress)}%) in ${elapsed} min`
        const toast = document.createElement('div')
        toast.className = 'toast-notify'
        toast.textContent = msg
        document.body.appendChild(toast)
        setTimeout(() => toast.remove(), 3000)
      }
      reset()
      window.location.hash = ''
    }
  }, [workspaceMode, backToWorkspace, reset])

  const handleClose = useCallback(() => {
    if (!workspaceMode && !activeDocId && markdown) {
      setShowCloseConfirm(true)
      return
    }
    doClose()
  }, [workspaceMode, activeDocId, markdown, doClose])

  const handleSaveAndClose = useCallback(async () => {
    if (!markdown || !fileName) return
    await addDocument(fileName, markdown)
    setShowCloseConfirm(false)
    doClose()
  }, [markdown, fileName, doClose])

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
      {/* Top row */}
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left: back + filename + progress + save */}
        <div className="flex items-center gap-2 min-w-0">
          {(workspaceMode || fromCollection) && markdown && (
            <button
              onClick={() => {
                sessionStorage.removeItem('md-reader-from-collection')
                if (fromCollection) backToCollection(); else backToWorkspace()
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

        {/* Right: grouped dropdowns + AI + close */}
        <div className="flex items-center gap-1">
          {/* Appearance dropdown */}
          <div ref={appearanceRef} className="relative">
            <button
              onClick={() => { setShowAppearance(!showAppearance); setShowMode(false) }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors border ${
                showAppearance
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title="Theme, font size, accessibility"
            >
              <Palette className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Appearance</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showAppearance ? 'rotate-180' : ''}`} />
            </button>
            {showAppearance && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 z-50">
                {/* Themes */}
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 font-medium">Theme</div>
                <div className="flex items-center gap-1 mb-3">
                  {themes.map((t) => (
                    <button
                      key={t.value}
                      onClick={(e) => { setTheme(t.value); const el = e.currentTarget; el.style.transform = 'scale(1.2)'; setTimeout(() => { el.style.transform = '' }, 200) }}
                      className={`p-1.5 rounded-md transition-all ${
                        theme === t.value
                          ? 'bg-blue-100 dark:bg-blue-950/50 shadow-sm text-blue-700 dark:text-blue-300'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      title={t.label}
                    >
                      {t.icon}
                    </button>
                  ))}
                </div>

                {/* Font size */}
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 font-medium">Font Size</div>
                <div className="flex items-center gap-1 mb-3">
                  <button
                    onClick={() => setFontSize(Math.max(14, fontSize - 2))}
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Decrease font size"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums w-8 text-center font-medium">{fontSize}</span>
                  <button
                    onClick={() => setFontSize(Math.min(28, fontSize + 2))}
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Increase font size"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Dyslexia font */}
                <button
                  onClick={() => setDyslexicFont(!dyslexicFont)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                    dyslexicFont
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Type className="h-3.5 w-3.5" />
                  Dyslexia-friendly font
                  {dyslexicFont && <Check className="h-3 w-3 ml-auto" />}
                </button>
              </div>
            )}
          </div>

          {/* Mode dropdown */}
          <div ref={modeRef} className="relative">
            <button
              onClick={() => { setShowMode(!showMode); setShowAppearance(false) }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors border ${
                showMode
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title="Focus, zen, print, shortcuts"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mode</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showMode ? 'rotate-180' : ''}`} />
            </button>
            {showMode && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1.5 z-50">
                {viewMode === 'read' && markdown && (
                  <>
                    <button
                      onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); setShowMode(false) }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <Maximize className="h-3.5 w-3.5" />
                      Focus mode
                      <span className="ml-auto text-[10px] text-gray-400">F</span>
                    </button>
                    <button
                      onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); setShowMode(false) }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-xs font-bold w-3.5 h-3.5 flex items-center justify-center">Z</span>
                      Zen mode
                      <span className="ml-auto text-[10px] text-gray-400">F</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => { window.print(); trackEvent('export_pdf'); setShowMode(false) }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print / Export PDF
                  <span className="ml-auto text-[10px] text-gray-400">P</span>
                </button>
                <button
                  onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); setShowMode(false) }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <span className="text-xs font-bold w-3.5 h-3.5 flex items-center justify-center">?</span>
                  Keyboard shortcuts
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

          {/* AI Settings */}
          <div ref={settingsRef} className="relative">
            <button
              onClick={() => { setShowSettings(!showSettings); setShowAppearance(false); setShowMode(false) }}
              className={`p-1.5 transition-colors relative rounded-md ${
                showSettings
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="AI Settings"
            >
              <Settings className="h-4 w-4" />
              <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                aiBackend === 'ollama' || aiBackend === 'openrouter' ? 'bg-green-500' : aiBackend === 'webllm' ? 'bg-blue-500' : 'bg-red-400'
              }`} title={`AI: ${aiBackend}`} />
            </button>

          {/* Close button */}
          {!isWorkspaceView && (
            <button
              onClick={handleClose}
              className="p-1.5 text-gray-500 hover:text-red-500 transition-colors"
              title={workspaceMode ? 'Back to library' : 'Close document'}
            >
              {workspaceMode ? <Library className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

          {/* AI Settings dropdown panel */}
          {showSettings && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50">
              <AiSettings onClose={() => { setShowSettings(false); setAiBackend(getActiveBackend()) }} />
            </div>
          )}
          </div>

      {/* Close Confirm Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCloseConfirm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Close without saving?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">This document hasn't been saved to your library yet.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveAndClose}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Save & Close
              </button>
              <button
                onClick={doClose}
                className="w-full px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Close anyway
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View mode tabs */}
      {showDocTabs && (
        <div data-view-tabs className="flex items-center gap-1 px-4 pb-2 overflow-x-auto" style={{ maskImage: 'linear-gradient(to right, black 90%, transparent)', WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent)' }}>
          {singleDocModes.map((vm) => (
            <button
              key={vm.value}
              onClick={() => { setViewMode(vm.value); localStorage.setItem(`md-reader-used-${vm.value}`, '1') }}
              title={viewShortcuts[vm.value] ? `${vm.tooltip} (${viewShortcuts[vm.value]})` : vm.tooltip}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === vm.value
                  ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {vm.icon}
              {vm.label}
              {vm.value === 'coach' && !localStorage.getItem(`md-reader-used-${vm.value}`) && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="New — try this feature" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
