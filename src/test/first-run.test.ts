import { describe, it, expect, beforeEach } from 'vitest'
import { bumpVisitCount, getVisitCount, shouldShowFirstTimeTip, shouldShowTelemetryBanner } from '../lib/first-run'

beforeEach(() => localStorage.clear())

describe('visit counter', () => {
  it('starts at 0 and increments per bump', () => {
    expect(getVisitCount()).toBe(0)
    expect(bumpVisitCount()).toBe(1)
    expect(bumpVisitCount()).toBe(2)
    expect(getVisitCount()).toBe(2)
  })
})

describe('shouldShowFirstTimeTip', () => {
  it('is false until the onboarding tour has completed', () => {
    expect(shouldShowFirstTimeTip()).toBe(false)
  })
  it('is true after the tour, before the tip has been shown', () => {
    localStorage.setItem('md-reader-onboarding-done', 'true')
    expect(shouldShowFirstTimeTip()).toBe(true)
  })
  it('is false once the tip has been shown', () => {
    localStorage.setItem('md-reader-onboarding-done', 'true')
    localStorage.setItem('md-reader-tip-shown', 'true')
    expect(shouldShowFirstTimeTip()).toBe(false)
  })
})

describe('shouldShowTelemetryBanner', () => {
  it('never shows on the first visit — the tour owns that moment', () => {
    bumpVisitCount()
    expect(shouldShowTelemetryBanner(false)).toBe(false)
  })
  it('shows from the second visit if not yet asked', () => {
    bumpVisitCount(); bumpVisitCount()
    expect(shouldShowTelemetryBanner(false)).toBe(true)
  })
  it('never shows once asked', () => {
    bumpVisitCount(); bumpVisitCount()
    expect(shouldShowTelemetryBanner(true)).toBe(false)
  })
})
