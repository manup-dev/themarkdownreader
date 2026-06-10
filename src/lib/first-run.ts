// Gates for the three first-run overlays (tour, shortcut tip, telemetry
// banner) so a new visitor sees exactly ONE prompt at a time:
//   visit 1: onboarding tour only
//   visit 2+: telemetry consent; shortcut tip once tour is done
// The visit counter is deliberately separate from telemetry.ts's
// sessionCount, which only increments after opt-in.

const VISIT_COUNT_KEY = 'md-reader-visit-count'
const TIP_SHOWN_KEY = 'md-reader-tip-shown'        // written by Reader.tsx
const ONBOARDING_DONE_KEY = 'md-reader-onboarding-done' // written by OnboardingOverlay.tsx

export function getVisitCount(): number {
  return parseInt(localStorage.getItem(VISIT_COUNT_KEY) ?? '0', 10) || 0
}

export function bumpVisitCount(): number {
  const n = getVisitCount() + 1
  localStorage.setItem(VISIT_COUNT_KEY, String(n))
  return n
}

export function shouldShowFirstTimeTip(): boolean {
  return !localStorage.getItem(TIP_SHOWN_KEY) && localStorage.getItem(ONBOARDING_DONE_KEY) === 'true'
}

export function shouldShowTelemetryBanner(hasBeenAsked: boolean): boolean {
  return !hasBeenAsked && getVisitCount() >= 2
}
