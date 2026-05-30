import { chat } from './ai'
import { PROMPTS } from './prompts'
import { slugify, taskId, type PlanTask } from './plan-tasks'

export function parseTaskJson(raw: string): PlanTask[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  let arr: unknown
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(arr)) return null
  const items = arr.filter(
    (x): x is { text: string; section?: string } =>
      !!x && typeof (x as { text?: unknown }).text === 'string'
  )
  return items.map((x, i) => {
    const sectionTitle = typeof x.section === 'string' ? x.section.trim() : ''
    const sectionId = slugify(sectionTitle)
    const text = x.text.trim()
    return {
      id: taskId(text, sectionId, i),
      text,
      status: 'open',
      source: 'ai',
      sectionId,
      sectionTitle,
    }
  })
}

export async function extractTasksWithAI(markdown: string, signal?: AbortSignal): Promise<PlanTask[]> {
  try {
    const raw = await chat(
      [
        { role: 'system', content: PROMPTS.extractTasks },
        { role: 'user', content: markdown },
      ],
      signal
    )
    return parseTaskJson(raw) ?? []
  } catch {
    return []
  }
}
