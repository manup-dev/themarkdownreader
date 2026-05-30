import { useMemo, useState, useCallback } from 'react'
import { ListChecks, ClipboardCopy, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { extractCheckboxTasks, buildDispatchPrompt, type PlanTask, type TaskStatus } from '../lib/plan-tasks'
import { planDocId, loadStatuses, saveStatus, mergeStatuses } from '../lib/plan-status'
import { extractTasksWithAI } from '../lib/plan-ai'
import { extractToc } from '../lib/markdown'
import { buildSectionCards } from '../lib/visualize'

function showToast(message: string) {
  const el = document.createElement('div')
  el.className = 'toast-notify'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = { open: 'done', done: 'blocked', blocked: 'open' }
const STATUS_GLYPH: Record<TaskStatus, string> = { open: '◻', done: '▣', blocked: '⚠' }
const STATUS_CLASS: Record<TaskStatus, string> = {
  open: 'text-slate-500',
  done: 'text-green-600',
  blocked: 'text-amber-600',
}

export function PlanView() {
  const markdown = useStore((s) => s.markdown)
  const fileName = useStore((s) => s.fileName)
  const activeDocId = useStore((s) => s.activeDocId)
  const docId = planDocId(activeDocId, fileName)

  const checkboxTasks = useMemo(() => extractCheckboxTasks(markdown), [markdown])
  const sectionText = useMemo(() => {
    const cards = buildSectionCards(markdown, extractToc(markdown))
    const map = new Map<string, string>()
    for (const c of cards) map.set(c.title, c.text)
    return map
  }, [markdown])

  const [aiTasks, setAiTasks] = useState<PlanTask[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [statusVersion, setStatusVersion] = useState(0)

  const base = aiTasks ?? checkboxTasks
  const tasks = useMemo(
    () => mergeStatuses(base, loadStatuses(docId)),
    [base, docId, statusVersion]
  )

  const cycleStatus = useCallback(
    (task: PlanTask) => {
      const next = STATUS_CYCLE[task.status]
      let blockedReason: string | undefined
      if (next === 'blocked') {
        blockedReason = window.prompt('Why is this blocked? (optional)') ?? undefined
      }
      saveStatus(docId, task.id, { status: next, blockedReason, ts: Date.now() })
      setStatusVersion((v) => v + 1)
    },
    [docId]
  )

  const dispatch = useCallback(
    async (task: PlanTask) => {
      const prompt = buildDispatchPrompt(task, {
        fileName: fileName ?? 'document.md',
        sectionTitle: task.sectionTitle,
        sectionText: sectionText.get(task.sectionTitle) ?? '',
      })
      try {
        await navigator.clipboard.writeText(prompt)
        showToast('Grounded prompt copied — paste into your agent')
      } catch {
        showToast('Copy failed — select and copy manually')
      }
    },
    [fileName, sectionText]
  )

  const runAiExtract = useCallback(async () => {
    setAiLoading(true)
    const result = await extractTasksWithAI(markdown)
    setAiLoading(false)
    if (result.length === 0) {
      showToast("Couldn't extract tasks — try again")
      return
    }
    setAiTasks(result)
  }, [markdown])

  const counts = useMemo(() => {
    const c = { open: 0, done: 0, blocked: 0 }
    for (const t of tasks) c[t.status]++
    return c
  }, [tasks])

  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, PlanTask[]>()
    for (const t of tasks) {
      if (!map.has(t.sectionTitle)) {
        map.set(t.sectionTitle, [])
        order.push(t.sectionTitle)
      }
      map.get(t.sectionTitle)!.push(t)
    }
    return order.map((title) => ({ title, items: map.get(title)! }))
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <ListChecks className="mx-auto mb-3 h-8 w-8 text-slate-400" />
        <p className="mb-4 text-slate-600 dark:text-slate-300">
          No checkbox tasks found in this document.
        </p>
        <button
          onClick={runAiExtract}
          disabled={aiLoading}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-60"
        >
          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {aiLoading ? 'Extracting…' : 'Extract tasks with AI'}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-5 w-5" /> Plan — {fileName ?? 'Document'}
        </h2>
        <span className="text-sm text-slate-500">
          {counts.open} open · {counts.done} done · {counts.blocked} blocked
        </span>
      </div>

      {groups.map((g) => (
        <div key={g.title || '__nosec'} className="mb-5">
          {g.title && (
            <h3 className="mb-2 text-sm font-medium text-slate-500">{g.title}</h3>
          )}
          <ul className="space-y-1.5">
            {g.items.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
              >
                <button
                  onClick={() => cycleStatus(t)}
                  title={`Status: ${t.status} (click to change)`}
                  className={`text-lg ${STATUS_CLASS[t.status]} focus-visible:ring-2 focus-visible:ring-blue-400`}
                  aria-label={`Task status ${t.status}, click to change`}
                >
                  {STATUS_GLYPH[t.status]}
                </button>
                <span
                  className={`flex-1 text-sm ${t.status === 'done' ? 'text-slate-400 line-through' : ''}`}
                >
                  {t.text}
                  {t.status === 'blocked' && t.blockedReason && (
                    <span className="ml-2 text-xs text-amber-600">({t.blockedReason})</span>
                  )}
                </span>
                <button
                  onClick={() => dispatch(t)}
                  title="Copy a grounded prompt for this task"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  <ClipboardCopy className="h-3.5 w-3.5" /> Dispatch
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
