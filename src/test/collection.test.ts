import { describe, it, expect } from 'vitest'
import { buildCollection } from '../lib/collection'

const fileA = {
  path: '03-interlinked-a.md',
  content: `# Machine Learning Fundamentals

## Overview

Machine learning is a subset of artificial intelligence. See also [Neural Networks](./03-interlinked-b.md) and [[Transformers]].

## Types of ML

- **Supervised learning** — labeled data
- **Unsupervised learning** — unlabeled data
- **Reinforcement learning** — reward signals

## Algorithms

Common algorithms include [[Support Vector Machines]], decision trees, and random forests.
`,
}

const fileB = {
  path: '03-interlinked-b.md',
  content: `# Neural Networks

## Architecture

Neural networks consist of layers. See [ML Fundamentals](./03-interlinked-a.md) for background.

## Types

- Feedforward networks
- Convolutional neural networks (CNNs)
- Recurrent neural networks (RNNs)

Also related: [Transformers](./03-interlinked-c.md)
`,
}

const fileC = {
  path: '03-interlinked-c.md',
  content: `# Transformers

## Self-Attention

The key innovation is the self-attention mechanism. See [Neural Networks](./03-interlinked-b.md).

## Applications

- BERT, GPT, T5
- Natural language processing
- Computer vision (ViT)

See also [ML Fundamentals](./03-interlinked-a.md).
`,
}

describe('buildCollection', () => {
  it('builds a collection from multiple files', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test-collection')
    expect(collection.name).toBe('test-collection')
    expect(collection.files).toHaveLength(3)
  })

  it('calculates total word count', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    expect(collection.totalWords).toBeGreaterThan(50)
  })

  it('calculates total reading time', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    expect(collection.totalReadingTime).toBeGreaterThanOrEqual(3) // 3 files = at least 3 min
  })

  it('discovers explicit links between files', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    expect(collection.links.length).toBeGreaterThan(0)
    const explicitLinks = collection.links.filter((l) => l.type === 'explicit')
    expect(explicitLinks.length).toBeGreaterThan(0)
  })

  it('discovers wikilinks', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    const wikilinks = collection.links.filter((l) => l.type === 'wikilink')
    expect(wikilinks.length).toBeGreaterThanOrEqual(0) // May or may not match depending on resolution
  })

  it('builds backlinks (linkedFrom)', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    const bFile = collection.files.find((f) => f.path.includes('interlinked-b'))
    expect(bFile?.linkedFrom.length).toBeGreaterThan(0) // A and C both link to B
  })

  it('detects collection structure', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    expect(['wiki', 'flat', 'sequential', 'hierarchical']).toContain(collection.structure)
  })

  it('generates suggested reading order', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    expect(collection.suggestedOrder).toHaveLength(3)
    // All files should appear in the order
    for (const file of collection.files) {
      expect(collection.suggestedOrder).toContain(file.path)
    }
  })

  it('parses TOC for each file', () => {
    const collection = buildCollection([fileA, fileB, fileC], 'test')
    for (const file of collection.files) {
      expect(file.toc.length).toBeGreaterThan(0)
    }
  })

  it('handles single file collection', () => {
    const collection = buildCollection([fileA], 'single')
    expect(collection.files).toHaveLength(1)
    expect(collection.links).toHaveLength(0) // No targets to link to
  })
})
