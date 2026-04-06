import type { ViewMode } from '../store/useStore'

export interface FeatureFlag {
  id: string
  label: string
  description: string
  viewMode: ViewMode
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  { id: 'podcast', label: 'Podcast', description: 'AI-generated audio overview of your document', viewMode: 'podcast' },
  { id: 'diagram', label: 'Diagram', description: 'AI-generated visual diagrams', viewMode: 'diagram' },
]

const LS_PREFIX = 'md-reader-feature-'

/** Read which features are enabled from all sources (localStorage > URL > env) */
export function resolveEnabledFeatures(): Set<string> {
  const enabled = new Set<string>()

  // 1. Env var defaults (lowest priority)
  const envFeatures = (import.meta.env.VITE_ENABLED_FEATURES ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
  for (const id of envFeatures) enabled.add(id)

  // 2. URL params (middle priority, auto-persist)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const urlFeatures = (params.get('features') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    for (const id of urlFeatures) {
      enabled.add(id)
      localStorage.setItem(`${LS_PREFIX}${id}`, 'true')
    }
    // Strip ?features= from URL after reading
    if (params.has('features')) {
      params.delete('features')
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`
      window.history.replaceState(null, '', newUrl)
    }
  }

  // 3. localStorage overrides (highest priority)
  for (const flag of FEATURE_FLAGS) {
    const stored = localStorage.getItem(`${LS_PREFIX}${flag.id}`)
    if (stored === 'true') enabled.add(flag.id)
    else if (stored === 'false') enabled.delete(flag.id)
  }

  // Filter to only known flag IDs
  const knownIds = new Set(FEATURE_FLAGS.map(f => f.id))
  return new Set([...enabled].filter(id => knownIds.has(id)))
}

/** Enable a feature flag and persist to localStorage */
export function enableFeature(id: string): void {
  localStorage.setItem(`${LS_PREFIX}${id}`, 'true')
}

/** Disable a feature flag and persist to localStorage */
export function disableFeature(id: string): void {
  localStorage.setItem(`${LS_PREFIX}${id}`, 'false')
}

/** Clear all feature flag overrides from localStorage */
export function resetFeatures(): void {
  for (const flag of FEATURE_FLAGS) {
    localStorage.removeItem(`${LS_PREFIX}${flag.id}`)
  }
}

/** Check if a specific view mode is gated behind a feature flag */
export function isViewModeGated(viewMode: ViewMode): string | null {
  const flag = FEATURE_FLAGS.find(f => f.viewMode === viewMode)
  return flag ? flag.id : null
}
