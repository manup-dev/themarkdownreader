/**
 * Pins the redaction helper that the OpenRouter error path runs every
 * response body through before it lands in an Error message. The hazard
 * being defended against: an upstream proxy or middleware that echoes
 * the Authorization header (or part of it) back in an error body — that
 * body would otherwise show up verbatim in console logs, toast
 * notifications, and any future error-reporting integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { redactOpenRouterKey } from '../lib/ai'

const STORAGE_KEY = 'md-reader-openrouter-key'

describe('redactOpenRouterKey', () => {
  beforeEach(() => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* SSR / private mode */ }
  })
  afterEach(() => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* SSR / private mode */ }
  })

  it('redacts modern sk-or-v1 keys', () => {
    const body = 'OpenRouter said: invalid key sk-or-v1-abc123XYZ_-789longenoughstring'
    expect(redactOpenRouterKey(body)).toBe(
      'OpenRouter said: invalid key sk-or-***REDACTED***',
    )
  })

  it('redacts legacy sk-or- keys without version segment', () => {
    const body = 'auth failed for sk-or-deadbeef12345678'
    expect(redactOpenRouterKey(body)).toBe('auth failed for sk-or-***REDACTED***')
  })

  it('leaves unrelated text alone', () => {
    const body = '429 Too Many Requests — rate limited upstream, please retry'
    expect(redactOpenRouterKey(body)).toBe(body)
  })

  it('does not redact short non-key strings starting with sk-or', () => {
    // The {8,} floor protects against false-positives on truncated/half-typed
    // strings that happen to share a prefix.
    expect(redactOpenRouterKey('sk-or-x')).toBe('sk-or-x')
  })

  it('returns empty/null inputs unchanged', () => {
    expect(redactOpenRouterKey('')).toBe('')
  })

  it('redacts the currently-stored key by exact string match', () => {
    // Defense-in-depth: even if a future key format slips past the regex,
    // the live key gets scrubbed by literal substring match.
    try {
      localStorage.setItem(STORAGE_KEY, 'CUSTOM-FUTURE-FORMAT-key-9999')
    } catch {
      // localStorage unavailable in this test env — skip the exact-match leg.
      return
    }
    const body = 'auth failed: token CUSTOM-FUTURE-FORMAT-key-9999 not recognized'
    expect(redactOpenRouterKey(body)).toBe(
      'auth failed: token ***REDACTED*** not recognized',
    )
  })

  it('runs in linear time on adversarial inputs (no catastrophic backtracking)', () => {
    // 50k char string of `sk-or-` partial prefixes interleaved with characters
    // that fail the optional `-v\d+` branch. A backtracking-vulnerable regex
    // would blow up here; ours bounds the quantifier to {8,200}.
    const adversarial = 'sk-or-vX'.repeat(6250) // 50_000 chars
    const start = performance.now()
    redactOpenRouterKey(adversarial)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100) // generous upper bound; real-world is <2ms
  })
})
