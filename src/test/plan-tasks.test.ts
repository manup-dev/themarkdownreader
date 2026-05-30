import { describe, it, expect } from 'vitest'
import { extractCheckboxTasks, buildDispatchPrompt } from '../lib/plan-tasks'

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

describe('buildDispatchPrompt', () => {
  const task = {
    id: 'task_x', text: 'Add rate-limiting to /api/login', status: 'open' as const,
    source: 'checkbox' as const, sectionId: 'security', sectionTitle: 'Security',
  }
  it('builds a grounded prompt with file, section, task, and context', () => {
    const out = buildDispatchPrompt(task, {
      fileName: 'plan.md', sectionTitle: 'Security', sectionText: 'We must protect auth endpoints.',
    })
    expect(out).toBe(
      'In `plan.md` under section "Security", implement this task:\n\n' +
      '  Add rate-limiting to /api/login\n\n' +
      'Section context:\n' +
      'We must protect auth endpoints.\n\n' +
      'Please implement it and report what you changed.'
    )
  })
  it('trims overly long section context to 1200 chars', () => {
    const long = 'x'.repeat(5000)
    const out = buildDispatchPrompt(task, { fileName: 'p.md', sectionTitle: 'S', sectionText: long })
    expect(out).toContain('x'.repeat(1200))
    expect(out).not.toContain('x'.repeat(1201))
  })
})
