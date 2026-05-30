import type { PlanTask, TaskStatus } from './plan-tasks'

export interface StoredStatus {
  status: TaskStatus
  blockedReason?: string
  ts: number
}

export function planDocId(activeDocId: number | null, fileName: string | null): string {
  return activeDocId != null ? `id:${activeDocId}` : `name:${fileName ?? 'doc'}`
}

const keyFor = (docId: string) => `md-reader-plan-status:${docId}`

export function loadStatuses(docId: string): Record<string, StoredStatus> {
  try {
    const raw = localStorage.getItem(keyFor(docId))
    return raw ? (JSON.parse(raw) as Record<string, StoredStatus>) : {}
  } catch {
    return {}
  }
}

export function saveStatus(docId: string, taskId: string, s: StoredStatus): void {
  const all = loadStatuses(docId)
  all[taskId] = s
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(all))
  } catch {
    /* quota/full — non-fatal */
  }
}

export function mergeStatuses(
  tasks: PlanTask[],
  stored: Record<string, StoredStatus>
): PlanTask[] {
  return tasks.map((t) => {
    const s = stored[t.id]
    return s ? { ...t, status: s.status, blockedReason: s.blockedReason } : t
  })
}
