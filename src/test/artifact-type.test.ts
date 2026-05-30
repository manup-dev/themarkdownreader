import { describe, it, expect } from 'vitest'
import { detectArtifactType } from '../lib/artifact-type'

describe('detectArtifactType — filename signals', () => {
  const cases: [string, string][] = [
    ['README.md', 'readme'],
    ['readme.markdown', 'readme'],
    ['TODO.md', 'todo'],
    ['tasks.md', 'todo'],
    ['2026-05-30-feature-plan.md', 'plan'],
    ['roadmap.md', 'plan'],
    ['design-spec.md', 'spec'],
    ['rfc-001.md', 'spec'],
    ['requirements.md', 'spec'],
    ['postmortem-2026.md', 'postmortem'],
    ['incident-report.md', 'postmortem'],
    ['research-notes.md', 'research'],
  ]
  it.each(cases)('classifies %s as %s', (file, type) => {
    expect(detectArtifactType(file, '').type).toBe(type)
  })
})

describe('detectArtifactType — content signals (generic filename)', () => {
  it('classifies as plan when 3+ checkboxes present', () => {
    const md = '## Work\n- [ ] a\n- [ ] b\n- [x] c\n'
    expect(detectArtifactType('notes.md', md).type).toBe('plan')
  })
  it('classifies as spec from requirements/non-goals headings', () => {
    expect(detectArtifactType('notes.md', '## Requirements\nx\n## Non-goals\ny\n').type).toBe('spec')
  })
  it('classifies as postmortem from root-cause/timeline headings', () => {
    expect(detectArtifactType('notes.md', '## Root cause\nx\n## Timeline\ny\n').type).toBe('postmortem')
  })
  it('classifies as research from findings/sources headings', () => {
    expect(detectArtifactType('notes.md', '## Findings\nx\n## Sources\ny\n').type).toBe('research')
  })
  it('falls back to doc for plain prose', () => {
    expect(detectArtifactType('notes.md', 'Just some prose, nothing special.').type).toBe('doc')
  })
})

describe('detectArtifactType — labels & edge cases', () => {
  it('returns a human label', () => {
    expect(detectArtifactType('README.md', '')).toEqual({ type: 'readme', label: 'README' })
    expect(detectArtifactType('x-plan.md', '')).toEqual({ type: 'plan', label: 'Plan' })
  })
  it('handles null filename (content-only)', () => {
    expect(detectArtifactType(null, '- [ ] a\n- [ ] b\n- [ ] c\n').type).toBe('plan')
  })
  it('handles empty input as doc', () => {
    expect(detectArtifactType(null, '').type).toBe('doc')
  })
})
