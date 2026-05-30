import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

export type TaskStatus = 'open' | 'done' | 'blocked'
export type TaskSource = 'checkbox' | 'ai'

export interface PlanTask {
  id: string
  text: string
  status: TaskStatus
  source: TaskSource
  sectionId: string
  sectionTitle: string
  blockedReason?: string
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function nodeText(node: { value?: string; children?: unknown[] }): string {
  if (typeof node.value === 'string') return node.value
  if (Array.isArray(node.children)) return node.children.map((c) => nodeText(c as never)).join('')
  return ''
}

function listItemText(node: { children?: { type?: string }[] }): string {
  const para = (node.children || []).find((c) => c.type === 'paragraph')
  return (para ? nodeText(para as never) : nodeText(node as never)).trim()
}

export function taskId(text: string, sectionId: string, index: number): string {
  const s = `${sectionId}:${index}:${text}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0
  return 'task_' + (h >>> 0).toString(36)
}

export function extractCheckboxTasks(markdown: string): PlanTask[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as { children?: unknown[] }
  const tasks: PlanTask[] = []
  let sectionId = ''
  let sectionTitle = ''
  let idxInSection = 0

  function walk(node: { type?: string; checked?: boolean | null; children?: unknown[] }) {
    if (node.type === 'heading') {
      sectionTitle = nodeText(node as never).trim()
      sectionId = slugify(sectionTitle)
      idxInSection = 0
    } else if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const text = listItemText(node as never)
      if (text) {
        tasks.push({
          id: taskId(text, sectionId, idxInSection),
          text,
          status: node.checked ? 'done' : 'open',
          source: 'checkbox',
          sectionId,
          sectionTitle,
        })
        idxInSection++
      }
    }
    if (Array.isArray(node.children)) node.children.forEach((c) => walk(c as never))
  }

  walk(tree as never)
  return tasks
}

export function buildDispatchPrompt(
  task: PlanTask,
  ctx: { fileName: string; sectionTitle: string; sectionText: string }
): string {
  const context = ctx.sectionText.trim().slice(0, 1200)
  return (
    `In \`${ctx.fileName}\` under section "${ctx.sectionTitle}", implement this task:\n\n` +
    `  ${task.text}\n\n` +
    `Section context:\n${context}\n\n` +
    `Please implement it and report what you changed.`
  )
}
