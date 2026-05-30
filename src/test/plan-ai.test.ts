import { describe, it, expect } from 'vitest'
import { parseTaskJson } from '../lib/plan-ai'

describe('parseTaskJson', () => {
  it('parses a clean JSON array into PlanTasks (source ai)', () => {
    const raw = '[{"text":"Do X","section":"Setup"},{"text":"Do Y","section":""}]'
    const tasks = parseTaskJson(raw)
    expect(tasks).toHaveLength(2)
    expect(tasks![0]).toMatchObject({ text: 'Do X', sectionTitle: 'Setup', sectionId: 'setup', source: 'ai', status: 'open' })
    expect(tasks![1]).toMatchObject({ text: 'Do Y', sectionTitle: '', sectionId: '' })
  })

  it('strips code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"text":"Z","section":"S"}]\n```\n'
    const tasks = parseTaskJson(raw)
    expect(tasks).toHaveLength(1)
    expect(tasks![0].text).toBe('Z')
  })

  it('returns null on malformed JSON', () => {
    expect(parseTaskJson('not json at all')).toBeNull()
  })

  it('drops items missing a text field', () => {
    const tasks = parseTaskJson('[{"section":"S"},{"text":"Keep"}]')
    expect(tasks).toHaveLength(1)
    expect(tasks![0].text).toBe('Keep')
  })

  it('produces unique stable ids', () => {
    const tasks = parseTaskJson('[{"text":"A","section":"S"},{"text":"B","section":"S"}]')!
    expect(new Set(tasks.map((t) => t.id)).size).toBe(2)
  })
})
