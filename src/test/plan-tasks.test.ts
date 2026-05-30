import { describe, it, expect } from 'vitest'
import { extractCheckboxTasks } from '../lib/plan-tasks'

const MD = `# Project

## Security
- [ ] Add rate-limiting to /api/login
- [x] Set up DB schema
- not a task, just a bullet

## Tests
- [ ] Write integration tests
`

describe('extractCheckboxTasks', () => {
  it('extracts checkbox items with status and section', () => {
    const tasks = extractCheckboxTasks(MD)
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({
      text: 'Add rate-limiting to /api/login',
      status: 'open',
      source: 'checkbox',
      sectionTitle: 'Security',
      sectionId: 'security',
    })
    expect(tasks[1]).toMatchObject({ text: 'Set up DB schema', status: 'done', sectionTitle: 'Security' })
    expect(tasks[2]).toMatchObject({ text: 'Write integration tests', status: 'open', sectionTitle: 'Tests' })
  })

  it('ignores plain (non-checkbox) list items', () => {
    expect(extractCheckboxTasks('- plain\n- items\n')).toHaveLength(0)
  })

  it('produces stable ids across calls', () => {
    const a = extractCheckboxTasks(MD).map((t) => t.id)
    const b = extractCheckboxTasks(MD).map((t) => t.id)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
  })

  it('handles tasks before any heading (empty section)', () => {
    const t = extractCheckboxTasks('- [ ] orphan task\n')
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ text: 'orphan task', sectionTitle: '', sectionId: '' })
  })
})
