import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Bot, User, Loader2, Sparkles, Cpu, Zap, Cloud, Trash2, Copy, Download } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { chunkMarkdown } from '../lib/markdown'
import { searchChunks } from '../lib/embeddings'
import { askAboutDocument, summarize, detectBestBackend, getActiveBackend, onWebLLMProgress, onModelProgress } from '../lib/ai'
import { trackEvent } from '../lib/telemetry'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

export function Chat() {
  const markdown = useStore((s) => s.markdown)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [backend, setBackend] = useState<string>('detecting...')
  const [modelProgress, setModelProgress] = useState<string | null>(null)
  const [modelProgressPct, setModelProgressPct] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Listen to Gemma model manager progress
    const unsubModel = onModelProgress((state) => {
      if (state.status === 'downloading') {
        setModelProgressPct(state.progress)
        setModelProgress(state.progressText)
      } else if (state.status === 'ready') {
        setModelProgress(null)
      }
    })

    // Legacy WebLLM progress
    onWebLLMProgress((pct, text) => {
      setModelProgressPct(pct)
      setModelProgress(text)
    })

    detectBestBackend().then((b) => setBackend(b))

    return unsubModel
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const chunks = useMemo(() => chunkMarkdown(markdown), [markdown])
  const abortRef = useRef<AbortController | null>(null)

  const sendQuestion = useCallback(async (question: string) => {
    if (loading) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question, timestamp: Date.now() }])
    setLoading(true)
    setStreamingText('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const relevant = searchChunks(question, chunks, 5)
      const contextTexts = relevant.map((c) => `[${c.sectionPath}]\n${c.text}`)
      const answer = await askAboutDocument(question, contextTexts, abortRef.current.signal, (token) => {
        setStreamingText((prev) => prev + token)
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: answer, timestamp: Date.now() }])
      setStreamingText('')
      trackEvent('ai_chat')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (!msg.includes('abort')) {
        const display = msg.includes('No AI backend')
          ? 'No AI backend configured. Open **AI Settings** (gear icon) to set up a free OpenRouter API key or download the browser model.'
          : `Error: ${msg}`
        setMessages((prev) => [...prev, { role: 'assistant', content: display, timestamp: Date.now() }])
      }
      setStreamingText('')
    } finally {
      setLoading(false)
      setBackend(getActiveBackend())
    }
  }, [loading, chunks])

  const handleSend = useCallback(async () => {
    const question = input.trim()
    if (!question) return
    sendQuestion(question)
  }, [input, sendQuestion])

  const handleSummarize = useCallback(async () => {
    if (loading) return
    setMessages((prev) => [...prev, { role: 'user', content: 'Summarize this document', timestamp: Date.now() }])
    setLoading(true)
    setStreamingText('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const summary = await summarize(markdown, abortRef.current.signal, (token) => {
        setStreamingText((prev) => prev + token)
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: summary, timestamp: Date.now() }])
      setStreamingText('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (!msg.includes('abort')) {
        const display = msg.includes('No AI backend')
          ? 'No AI backend configured. Open **AI Settings** (gear icon) to set up a free OpenRouter API key or download the browser model.'
          : `Error: ${msg}`
        setMessages((prev) => [...prev, { role: 'assistant', content: display, timestamp: Date.now() }])
      }
      setStreamingText('')
    } finally {
      setLoading(false)
      setBackend(getActiveBackend())
    }
  }, [loading, markdown])

  const sendDirect = useCallback(async (question: string) => {
    sendQuestion(question)
  }, [sendQuestion])

  const isReady = backend === 'webllm' || backend === 'ollama' || backend === 'openrouter'

  // Delight #31: Suggested questions from document headings
  const toc = useStore((s) => s.toc)
  const suggestedQuestions = (() => {
    const h2s = toc.filter((t) => t.level === 2)
    if (h2s.length === 0) return []
    const questions = []
    if (h2s[0]) questions.push(`What is "${h2s[0].text}" about?`)
    if (h2s.length >= 2) questions.push(`How does "${h2s[0].text}" relate to "${h2s[h2s.length - 1].text}"?`)
    if (h2s.length >= 3) questions.push(`What are the key differences between the topics covered?`)
    else if (h2s[1]) questions.push(`Summarize "${h2s[1].text}" in one sentence`)
    return questions
  })()

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">
            Ask about this document
          </h3>
          {messages.length > 0 && (
            <p className="text-[9px] text-gray-400 mt-0.5 truncate max-w-[180px]">
              Topic: {messages.find((m) => m.role === 'user')?.content.slice(0, 40) ?? 'General'}
            </p>
          )}
          <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <>
            <button
              onClick={() => {
                const fileName = useStore.getState().fileName ?? 'document'
                const md = `# Q&A: ${fileName}\n\n` + messages.map((m) =>
                  m.role === 'user' ? `**Q:** ${m.content}` : `**A:** ${m.content}`
                ).join('\n\n') + `\n\n---\n*Generated with [md-reader](https://github.com/manup-dev/themarkdownreader) — Read it. Ship it.*`
                const blob = new Blob([md], { type: 'text/markdown' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `${fileName.replace(/\.md$/, '')}-qa.md`
                a.click()
                URL.revokeObjectURL(a.href)
                trackEvent('export_chat')
              }}
              className="p-1 text-gray-300 hover:text-blue-400 transition-colors rounded"
              title="Export chat as markdown"
              aria-label="Export chat"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={() => setMessages([])}
              className="p-1 text-gray-300 hover:text-red-400 transition-colors rounded"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            </>
          )}
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
            backend === 'openrouter'
              ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
              : backend === 'webllm'
                ? 'bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400'
                : backend === 'ollama'
                  ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
          }`}>
            {backend === 'openrouter' && <><Cloud className="h-2.5 w-2.5" /> Cloud</>}
            {backend === 'webllm' && <><Zap className="h-2.5 w-2.5" /> WebGPU</>}
            {backend === 'ollama' && <><Cpu className="h-2.5 w-2.5" /> Ollama</>}
            {backend === 'none' && 'No AI'}
            {backend === 'detecting...' && 'Detecting...'}
          </span>
          <span className="text-[9px] text-gray-400 ml-1" title="Approximate context usage">
            {(() => {
              const totalChars = messages.reduce((s, m) => s + m.content.length, 0) + (streamingText?.length ?? 0)
              const pct = Math.min(100, Math.round((totalChars / 4000) * 100))
              return pct > 50 ? `${pct}% ctx` : null
            })()}
          </span>
          </div>
        </div>

        {modelProgress && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2 text-xs text-blue-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">{modelProgress}</span>
            </div>
            <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${modelProgressPct * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !modelProgress && (
          <div className="text-center py-8 space-y-3">
            <Bot className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto" />
            <p className="text-sm text-gray-400">
              {isReady ? 'Ask me anything about this document' : backend === 'detecting...' ? 'Detecting AI backend...' : 'No AI backend available'}
            </p>
            {isReady && (
              <>
                <button
                  onClick={handleSummarize}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  {(markdown.match(/```/g) ?? []).length >= 4 ? 'Summarize code & concepts' : (markdown.match(/^\|/gm) ?? []).length >= 4 ? 'Summarize data & tables' : 'Summarize document'}
                </button>
                {suggestedQuestions.length > 0 && (
                  <>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => setInput(q)}
                        className="text-[10px] px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5 justify-center mt-1">
                    <button
                      onClick={() => sendDirect('List the main concepts in this document as a bulleted list')}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/30 text-purple-500 dark:text-purple-400 hover:bg-purple-100 transition-colors"
                    >
                      List concepts
                    </button>
                    <button
                      onClick={() => sendDirect('What prerequisites do I need to understand this document?')}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-500 dark:text-amber-400 hover:bg-amber-100 transition-colors"
                    >
                      Prerequisites
                    </button>
                    <button
                      onClick={() => {
                        const docId = useStore.getState().activeDocId
                        const tocEntries = useStore.getState().toc
                        const read = docId ? JSON.parse(localStorage.getItem(`md-reader-sections-read-${docId}`) ?? '[]') as string[] : []
                        const unread = tocEntries.filter((t) => t.level <= 2 && !read.includes(t.id)).map((t) => t.text)
                        if (unread.length === 0) {
                          sendDirect('I\'ve read all sections. What are the key takeaways from the entire document?')
                        } else {
                          sendDirect(`I haven't read these sections yet: ${unread.slice(0, 3).join(', ')}. Give me a brief preview of what they cover.`)
                        }
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-400 hover:bg-red-100 transition-colors"
                    >
                      What did I miss?
                    </button>
                  </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <React.Fragment key={i}>
          <div className={`flex gap-2 group ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && <Bot className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />}
            <div className={`relative text-sm rounded-xl px-3 py-2 max-w-[85%] ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-headings:text-sm prose-pre:my-1 prose-pre:text-xs prose-code:text-xs max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]} skipHtml>{msg.content}</Markdown>
                </div>
              ) : (
                <div className="prose prose-sm prose-invert prose-p:my-0 max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]} skipHtml>{msg.content}</Markdown>
                </div>
              )}
              {msg.role === 'assistant' && (
                <button
                  onClick={() => { navigator.clipboard.writeText(msg.content); const btn = document.querySelector(`[data-copy-idx="${i}"]`); if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = ''; }, 1500) } }}
                  data-copy-idx={i}
                  className="absolute -right-1 -top-1 p-1 rounded bg-white dark:bg-gray-700 shadow-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                  title="Copy message"
                  aria-label="Copy message"
                >
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </div>
            {msg.role === 'user' && <User className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />}
          </div>
          <div className={`text-[9px] text-gray-300 dark:text-gray-600 mt-0.5 ${msg.role === 'user' ? 'text-right mr-7' : 'ml-7'}`}>
            {timeAgo(msg.timestamp)}
          </div>
        </React.Fragment>
        ))}

        {/* Streaming response */}
        {loading && streamingText && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-800 dark:text-gray-200 max-w-[85%]">
              <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-headings:my-2 prose-headings:text-sm prose-pre:my-1 prose-pre:text-xs prose-code:text-xs max-w-none">
                <Markdown remarkPlugins={[remarkGfm]} skipHtml>{streamingText}</Markdown>
                <span className="animate-pulse">|</span>
                <button
                  onClick={() => { abortRef.current?.abort(); setLoading(false) }}
                  className="ml-2 text-[10px] text-gray-400 hover:text-red-400 transition-colors"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading spinner (before streaming starts) */}
        {loading && !streamingText && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-2 max-w-[85%] space-y-2">
              <div className="animate-pulse space-y-1.5">
                <div className="h-2.5 bg-gray-300 dark:bg-gray-600 rounded w-full" />
                <div className="h-2.5 bg-gray-300 dark:bg-gray-600 rounded w-4/5" />
                <div className="h-2.5 bg-gray-300 dark:bg-gray-600 rounded w-3/5" />
              </div>
              <button
                onClick={() => { abortRef.current?.abort(); setLoading(false); setStreamingText('') }}
                className="text-[10px] text-gray-400 hover:text-red-400 transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        )}
        {/* Section jump badges from AI response */}
        {messages.length >= 2 && !loading && messages[messages.length - 1].role === 'assistant' && (() => {
          const lastMsg = messages[messages.length - 1].content.toLowerCase()
          const mentioned = toc.filter((t) => t.level <= 3 && lastMsg.includes(t.text.toLowerCase()))
          if (mentioned.length === 0) return null
          return (
            <div className="flex flex-wrap gap-1 ml-7 mt-1">
              {mentioned.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    useStore.getState().setViewMode('read')
                    setTimeout(() => {
                      document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 200)
                  }}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 transition-colors"
                >
                  Jump to: {t.text}
                </button>
              ))}
            </div>
          )
        })()}
        {/* Follow-up suggestions after last response */}
        {messages.length >= 2 && !loading && messages[messages.length - 1].role === 'assistant' && (
          <div className="flex flex-wrap gap-1.5 ml-7 mt-1">
            <button
              onClick={() => sendDirect('Can you explain that more simply?')}
              className="text-[10px] px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              Explain more simply
            </button>
            <button
              onClick={() => sendDirect('Can you give me an example?')}
              className="text-[10px] px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              Give me an example
            </button>
            <button
              onClick={() => sendDirect('What else should I know about this?')}
              className="text-[10px] px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              What else should I know?
            </button>
            <button
              onClick={() => sendDirect('Draw a simple ASCII diagram showing how the main concepts relate to each other. Use boxes and arrows.')}
              className="text-[10px] px-2 py-1 rounded-full bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
            >
              Show diagram
            </button>
            <button
              onClick={() => sendDirect('Compare and contrast the first section and the last section of this document. What changed?')}
              className="text-[10px] px-2 py-1 rounded-full bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
            >
              Compare sections
            </button>
            <button
              onClick={() => sendDirect('Explain your last answer in exactly 280 characters or less — tweet-length, punchy, no fluff.')}
              className="text-[10px] px-2 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition-colors"
            >
              Tweet-length
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isReady ? 'Ask a question... (Enter to send)' : 'Waiting for AI...'}
            aria-label="Ask a question about this document"
            disabled={!isReady}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !isReady}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {input.length > 100 && (
          <p className={`text-[10px] mt-1 ${input.length > 400 ? 'text-red-400' : 'text-gray-400'}`}>
            {input.length}/500 chars {input.length > 400 ? '— long queries may reduce answer quality' : ''}
          </p>
        )}
      </div>
    </div>
  )
}
