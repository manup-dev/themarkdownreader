/**
 * Optional, anonymous, privacy-respecting usage telemetry.
 * - Completely opt-in (disabled by default)
 * - No personal data collected
 * - No cookies or fingerprinting
 * - Only tracks feature usage counts
 * - All data stays in localStorage
 * - Can be exported by the user at any time
 */

const TELEMETRY_KEY = 'md-reader-telemetry'
const TELEMETRY_ENABLED_KEY = 'md-reader-telemetry-enabled'

export type TelemetryEvent =
  | 'doc_opened'
  | 'view_read' | 'view_mindmap' | 'view_cards' | 'view_treemap' | 'view_graph' | 'view_coach'
  | 'ai_chat' | 'ai_summarize' | 'ai_explain' | 'ai_coach' | 'ai_quiz'
  | 'tts_play'
  | 'highlight_added' | 'comment_added'
  | 'export_chat' | 'export_highlights' | 'export_pdf'
  | 'keyboard_shortcut'
  | 'theme_dark' | 'theme_sepia' | 'theme_light' | 'theme_high_contrast'
  | 'library_multi_doc'
  | 'mindmap_depth_change'

interface TelemetryData {
  events: Record<string, number>  // event name -> count
  firstSeen: number               // timestamp
  lastSeen: number                // timestamp
  sessionCount: number
}

export function isTelemetryEnabled(): boolean {
  return localStorage.getItem(TELEMETRY_ENABLED_KEY) === 'true'
}

export function enableTelemetry(): void {
  localStorage.setItem(TELEMETRY_ENABLED_KEY, 'true')
}

export function disableTelemetry(): void {
  localStorage.setItem(TELEMETRY_ENABLED_KEY, 'false')
}

export function trackEvent(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return
  const raw = localStorage.getItem(TELEMETRY_KEY)
  const data: TelemetryData = raw ? JSON.parse(raw) : { events: {}, firstSeen: Date.now(), lastSeen: Date.now(), sessionCount: 0 }
  data.events[event] = (data.events[event] ?? 0) + 1
  data.lastSeen = Date.now()
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(data))
}

export function incrementSession(): void {
  if (!isTelemetryEnabled()) return
  const raw = localStorage.getItem(TELEMETRY_KEY)
  const data: TelemetryData = raw ? JSON.parse(raw) : { events: {}, firstSeen: Date.now(), lastSeen: Date.now(), sessionCount: 0 }
  data.sessionCount++
  data.lastSeen = Date.now()
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(data))
}

/** User can export their own telemetry data */
export function exportTelemetry(): TelemetryData | null {
  const raw = localStorage.getItem(TELEMETRY_KEY)
  return raw ? JSON.parse(raw) : null
}

/** User can delete all telemetry data */
export function clearTelemetry(): void {
  localStorage.removeItem(TELEMETRY_KEY)
}
