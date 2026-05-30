import { describe, it, expect } from 'vitest'
import { diffMarkdown, buildDiffSummary } from './diff'

const OLD = `# Plan
## Security
- harden auth
- add rate limiting
## Tests
- unit tests
`
const NEW = `# Plan
## Security
- harden auth
- add rate limiting
- rotate secrets
## Deployment
- set up CI
`

describe('diffMarkdown', () => {
  it('classifies added, removed, changed, unchanged sections', () => {
    const d = diffMarkdown(OLD, NEW)
    const by = Object.fromEntries(d.map((s) => [s.title, s]))
    expect(by['Security'].status).toBe('changed')
    expect(by['Security'].added).toBe(1)   // rotate secrets
    expect(by['Security'].removed).toBe(0)
    expect(by['Deployment'].status).toBe('added')
    expect(by['Tests'].status).toBe('removed')
    expect(by['Plan'].status).toBe('unchanged')
  })

  it('counts removed lines in a changed section', () => {
    const d = diffMarkdown('## A\n- one\n- two\n', '## A\n- one\n')
    const a = d.find((s) => s.title === 'A')!
    expect(a.status).toBe('changed')
    expect(a.removed).toBe(1)
    expect(a.added).toBe(0)
  })
})

describe('buildDiffSummary', () => {
  it('summarises changes, omitting unchanged sections', () => {
    const text = buildDiffSummary(diffMarkdown(OLD, NEW), 'plan.v1.md', 'plan.v2.md')
    expect(text).toContain('plan.v1.md')
    expect(text).toContain('plan.v2.md')
    expect(text).toContain('Deployment')   // added
    expect(text).toContain('Tests')        // removed
    expect(text).toContain('Security')     // changed
    expect(text).not.toContain('unchanged')
  })

  it('reports when nothing changed', () => {
    expect(buildDiffSummary(diffMarkdown('## A\n- x\n', '## A\n- x\n'), 'a', 'b')).toMatch(/no.*change/i)
  })
})
