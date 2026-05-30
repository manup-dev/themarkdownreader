import { describe, it, expect, beforeEach } from 'vitest'
import { planDocId, loadStatuses, saveStatus, mergeStatuses } from '../lib/plan-status'
import type { PlanTask } from '../lib/plan-tasks'

const tasks: PlanTask[] = [
  { id: 't1', text: 'A', status: 'open', source: 'checkbox', sectionId: 's', sectionTitle: 'S' },
  { id: 't2', text: 'B', status: 'done', source: 'checkbox', sectionId: 's', sectionTitle: 'S' },
]

describe('plan-status', () => {
  beforeEach(() => localStorage.clear())

  it('planDocId prefers numeric docId, falls back to fileName', () => {
    expect(planDocId(7, 'x.md')).toBe('id:7')
    expect(planDocId(null, 'x.md')).toBe('name:x.md')
    expect(planDocId(null, null)).toBe('name:doc')
  })

  it('saves and loads per-doc statuses', () => {
    saveStatus('id:7', 't1', { status: 'blocked', blockedReason: 'waiting', ts: 1 })
    expect(loadStatuses('id:7')).toEqual({ t1: { status: 'blocked', blockedReason: 'waiting', ts: 1 } })
    expect(loadStatuses('id:8')).toEqual({})
  })

  it('mergeStatuses: stored status overrides checkbox default', () => {
    const merged = mergeStatuses(tasks, { t1: { status: 'done', ts: 1 } })
    expect(merged[0].status).toBe('done')
    expect(merged[1].status).toBe('done')
  })

  it('mergeStatuses: missing stored keeps default; unknown ids ignored', () => {
    const merged = mergeStatuses(tasks, { tZ: { status: 'blocked', ts: 1 } })
    expect(merged[0].status).toBe('open')
    expect(merged.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('mergeStatuses carries blockedReason', () => {
    const merged = mergeStatuses(tasks, { t1: { status: 'blocked', blockedReason: 'dep', ts: 1 } })
    expect(merged[0]).toMatchObject({ status: 'blocked', blockedReason: 'dep' })
  })
})
