import { describe, it, expect } from 'vitest'
import { decodeWal, materialize } from '../src/parser'

describe('parser re-export', () => {
  it('decodes a JSONL WAL and materializes a comment', () => {
    const wal = JSON.stringify({
      v: 1, ts: 1, id: 'c1', op: 'comment.add',
      docKey: 'd', anchor: { line: 3, text: 'foo' },
      selectedText: 'foo', body: 'nice', author: 'manu', sectionId: 's1',
    }) + '\n'
    const events = decodeWal(wal)
    const state = materialize(events)
    expect(state.comments.size).toBe(1)
    expect(state.comments.get('c1')?.body).toBe('nice')
  })
})
