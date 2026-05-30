import { describe, it, expect } from 'vitest'
import { extractTasks, buildTaskPrompt } from './plan'

const MD = `# Project

## Security
- [ ] Add rate-limiting to /api/login
- [x] Set up DB schema
- not a task

## Tests
* [ ] Write integration tests
`

describe('extractTasks', () => {
  it('parses checkbox tasks with status and section', () => {
    const tasks = extractTasks(MD)
    expect(tasks).toEqual([
      { text: 'Add rate-limiting to /api/login', status: 'open', section: 'Security' },
      { text: 'Set up DB schema', status: 'done', section: 'Security' },
      { text: 'Write integration tests', status: 'open', section: 'Tests' },
    ])
  })

  it('accepts both - and * bullets and X or x', () => {
    expect(extractTasks('- [X] A\n* [ ] B\n')).toEqual([
      { text: 'A', status: 'done', section: '' },
      { text: 'B', status: 'open', section: '' },
    ])
  })

  it('ignores non-task bullets and plain text', () => {
    expect(extractTasks('- plain\nsome text\n')).toEqual([])
  })
})

describe('buildTaskPrompt', () => {
  it('builds a grounded prompt referencing file, section, and task', () => {
    const p = buildTaskPrompt(
      { text: 'Add rate-limiting to /api/login', status: 'open', section: 'Security' },
      'plan.md'
    )
    expect(p).toBe(
      'In `plan.md` under section "Security", implement this task:\n\n' +
      '  Add rate-limiting to /api/login\n\n' +
      'Please implement it and report what you changed.'
    )
  })

  it('omits the section clause when there is no section', () => {
    const p = buildTaskPrompt({ text: 'Do X', status: 'open', section: '' }, 'p.md')
    expect(p).toBe(
      'In `p.md`, implement this task:\n\n' +
      '  Do X\n\n' +
      'Please implement it and report what you changed.'
    )
  })
})
