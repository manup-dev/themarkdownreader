import { describe, it, expect } from 'vitest'
import { materialize, dedupeEvents, compareEvents } from '../src/parser'
import type { AnnotationEvent } from '../src/parser'

describe('compareEvents', () => {
  it('orders comment.add before comment.resolve at the same ts/clientId', () => {
    const add: AnnotationEvent = { v:1, ts:100, id:'c1', op:'comment.add',
      docKey:'d', anchor:{}, selectedText:'x', body:'b', author:'a', sectionId:'s' } as AnnotationEvent
    const resolve: AnnotationEvent = { v:1, ts:100, id:'c1', op:'comment.resolve', docKey:'d', resolved:true } as AnnotationEvent
    expect(compareEvents(add, resolve)).toBeLessThan(0)
    expect(compareEvents(resolve, add)).toBeGreaterThan(0)
  })
})

describe('materialize with out-of-order resolve', () => {
  it('preserves resolved=true even when input lists resolve before add', () => {
    const events: AnnotationEvent[] = [
      { v:1, ts:200, id:'c1', op:'comment.resolve', docKey:'d', resolved:true } as AnnotationEvent,
      { v:1, ts:100, id:'c1', op:'comment.add', docKey:'d', anchor:{},
        selectedText:'x', body:'b', author:'a', sectionId:'s' } as AnnotationEvent,
    ]
    const sorted = dedupeEvents(events)
    const state = materialize(sorted)
    expect(state.comments.get('c1')?.resolved).toBe(true)
  })
})

describe('dedupeEvents picks latest by ts on (id,op) collision', () => {
  it('keeps the higher-ts duplicate regardless of input order', () => {
    const stale: AnnotationEvent = { v:1, ts:100, id:'c1', op:'comment.resolve', docKey:'d', resolved:false } as AnnotationEvent
    const fresh: AnnotationEvent = { v:1, ts:200, id:'c1', op:'comment.resolve', docKey:'d', resolved:true } as AnnotationEvent
    // Stale appears AFTER fresh in input
    const out = dedupeEvents([fresh, stale])
    const resolve = out.find((e) => e.op === 'comment.resolve') as { resolved: boolean } | undefined
    expect(resolve?.resolved).toBe(true)
  })
})

describe('comment.del before comment.add is a no-op', () => {
  it('does not crash and leaves state empty', () => {
    const events: AnnotationEvent[] = [
      { v:1, ts:100, id:'c1', op:'comment.del', docKey:'d' } as AnnotationEvent,
    ]
    const state = materialize(events)
    expect(state.comments.size).toBe(0)
  })
})

describe('forward-compat: v>SCHEMA_VERSION events survive a checkpoint round-trip', () => {
  it('preserves unknown future events through reduce', () => {
    const future = { v:99, ts:100, id:'x', op:'mystery.op', forwardCompat:true } as unknown as AnnotationEvent
    const state = materialize([future])
    expect(state.unknown.length).toBe(1)
  })
})

describe('dedupeEvents output is ts-sorted even after key updates', () => {
  it('produces chronological order when a duplicate key has the highest ts', () => {
    // Three events: c@ts=50 (stale), b@ts=100, c@ts=300 (winner).
    // After Round 1's fix this returned [c300, b100] — broken.
    const cStale: AnnotationEvent = { v:1, ts:50,  id:'c', op:'comment.resolve', docKey:'d', resolved:false } as AnnotationEvent
    const b:      AnnotationEvent = { v:1, ts:100, id:'b', op:'comment.add', docKey:'d', anchor:{},
      selectedText:'x', body:'b', author:'a', sectionId:'s' } as AnnotationEvent
    const cFresh: AnnotationEvent = { v:1, ts:300, id:'c', op:'comment.resolve', docKey:'d', resolved:true } as AnnotationEvent

    const out = dedupeEvents([cFresh, b, cStale])
    expect(out.length).toBe(2)
    // Must be chronological: b (ts=100) before cFresh (ts=300).
    expect(out[0]).toBe(b)
    expect(out[1]).toBe(cFresh)
  })

  it('end-to-end: three-event interleaving with resolve-without-prior-add no longer drops resolve', () => {
    const add:     AnnotationEvent = { v:1, ts:100, id:'c', op:'comment.add', docKey:'d', anchor:{},
      selectedText:'x', body:'b', author:'a', sectionId:'s' } as AnnotationEvent
    const other:   AnnotationEvent = { v:1, ts:150, id:'b', op:'comment.add', docKey:'d', anchor:{},
      selectedText:'y', body:'q', author:'a', sectionId:'s' } as AnnotationEvent
    const resolve: AnnotationEvent = { v:1, ts:200, id:'c', op:'comment.resolve', docKey:'d', resolved:true } as AnnotationEvent

    // Hostile input order
    const merged = dedupeEvents([resolve, add, other])
    const state = materialize(merged)
    expect(state.comments.get('c')?.resolved).toBe(true)
  })
})

describe('compareEvents OP_PRIORITY tiebreaker (same ts)', () => {
  it('orders comment.add before comment.resolve at identical ts and clientId', () => {
    const add: AnnotationEvent = { v:1, ts:100, clientId:'A', id:'c', op:'comment.add',
      docKey:'d', anchor:{}, selectedText:'x', body:'b', author:'a', sectionId:'s' } as AnnotationEvent
    const resolve: AnnotationEvent = { v:1, ts:100, clientId:'A', id:'c', op:'comment.resolve',
      docKey:'d', resolved:true } as AnnotationEvent
    expect(compareEvents(add, resolve)).toBeLessThan(0)
    // End-to-end: hostile input → still resolved
    const state = materialize(dedupeEvents([resolve, add]))
    expect(state.comments.get('c')?.resolved).toBe(true)
  })
})
