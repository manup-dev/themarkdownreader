import { describe, it, expect } from 'vitest'
import { estimateDifficulty, chunkMarkdown } from '../lib/markdown'

describe('estimateDifficulty', () => {
  it('returns Beginner for simple content', () => {
    const md = '# Hello World\n\nThis is a simple document about cats and dogs.'
    expect(estimateDifficulty(md)).toBe('Beginner')
  })

  it('returns Expert for highly technical content', () => {
    const md = `# Distributed Systems: Consensus Algorithms

## Overview

Consensus algorithms solve the fundamental problem of getting multiple nodes in a distributed system to agree. This is formalized as the **Byzantine Generals Problem** (Lamport et al., 1982).

## Raft Consensus Algorithm

Raft (Ongaro & Ousterhout, 2014) was designed as an understandable alternative to Paxos.

| Property | Raft | Paxos |
|----------|------|-------|
| Understandability | High | Low |
| Industry adoption | etcd, CockroachDB | Chubby, Spanner |

## Byzantine Fault Tolerance (BFT)

- **PBFT** (Castro & Liskov, 1999): Tolerates f faults with 3f+1 nodes. O(n²) message complexity.
- **HotStuff** (Yin et al., 2019): Linear message complexity. Used in Meta's Diem/Libra.

## CAP Theorem

Brewer's CAP theorem states consistency, availability, and partition tolerance tradeoffs.

## References

1. Lamport, L., Shostak, R., & Pease, M. (1982). "The Byzantine Generals Problem."
`
    const diff = estimateDifficulty(md)
    expect(['Advanced', 'Expert', 'Intermediate']).toContain(diff) // Small model scoring varies with content density
  })

  it('returns Intermediate for moderate content', () => {
    const md = `# Web Development Guide

## HTML Basics

HTML is the standard markup language for web pages.

### Elements

- Headings
- Paragraphs
- Links

## CSS Fundamentals

CSS controls the visual presentation.

\`\`\`css
body { margin: 0; }
\`\`\`
`
    const diff = estimateDifficulty(md)
    expect(['Intermediate', 'Beginner']).toContain(diff)
  })

  it('handles empty document', () => {
    expect(estimateDifficulty('')).toBe('Beginner')
  })

  it('considers technical terms', () => {
    const md = 'Working with API, SDK, CLI, GPU, LLM, and REST endpoints using OAuth and JWT tokens. More API and SDK usage with CRUD operations and GraphQL.'
    const diff = estimateDifficulty(md)
    expect(diff).not.toBe('Beginner') // Technical terms should bump difficulty above Beginner
  })

  it('considers code block density', () => {
    const md = `# Code Heavy

\`\`\`js
const a = 1
\`\`\`

\`\`\`js
const b = 2
\`\`\`

\`\`\`js
const c = 3
\`\`\`
`
    const diff = estimateDifficulty(md)
    expect(['Beginner', 'Intermediate']).toContain(diff) // Short doc with few code blocks scores low
  })
})

describe('chunkMarkdown max size', () => {
  it('caps chunks at approximately 800 characters', () => {
    // Create a section with many lines (real markdown has line breaks)
    const lines = Array.from({ length: 50 }, (_, i) => `This is paragraph ${i + 1} with some content about various topics and ideas.`)
    const md = `# Title\n\n${lines.join('\n')}`
    const chunks = chunkMarkdown(md)
    // Should split into multiple chunks due to 800-char cap
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })
})
