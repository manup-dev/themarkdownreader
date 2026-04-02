/**
 * Optional, anonymous, privacy-respecting usage telemetry.
 *
 * - Completely opt-in (disabled by default)
 * - No personal data collected — no names, emails, IPs, filenames, or content
 * - No cookies or fingerprinting
 * - Only tracks feature usage counts (e.g., "mind map opened 3 times")
 * - Remote telemetry via PostHog (if VITE_POSTHOG_KEY is set)
 * - Local copy in localStorage (user can export/delete anytime)
 *
 * What IS tracked (all non-PII):
 *   - Feature usage counts (which views, AI features, reading modes)
 *   - AI backend type (ollama/openrouter/webllm — not keys or URLs)
 *   - Theme preference (light/dark/sepia/high-contrast)
 *   - Session count
 *
 * What is NEVER tracked:
 *   - File contents, filenames, or document text
 *   - Usernames, emails, or any PII
 *   - API keys, URLs, or server addresses
 *   - Chat messages, comments, or highlights
 *   - IP addresses (PostHog configured to discard)
 */

import posthog from 'posthog-js'

// ─── Storage keys ──────────────────────────────────────────────────────────
const TELEMETRY_KEY = 'md-reader-telemetry'
const TELEMETRY_ENABLED_KEY = 'md-reader-telemetry-enabled'
// 'true' = opted in, 'false' = declined, absent = never asked
const TELEMETRY_ASKED_KEY = 'md-reader-telemetry-asked'

// ─── Event types ───────────────────────────────────────────────────────────
export type TelemetryEvent =
  | 'doc_opened'
  | 'view_read' | 'view_mindmap' | 'view_cards' | 'view_treemap' | 'view_graph' | 'view_coach'
  | 'ai_chat' | 'ai_summarize' | 'ai_explain' | 'ai_coach' | 'ai_quiz'
  | 'tts_play'
  | 'highlight_added' | 'comment_added'
  | 'export_chat' | 'export_highlights' | 'export_pdf' | 'export_markdown'
  | 'prompt_builder_opened' | 'prompt_builder_copied' | 'prompt_builder_terminal'
  | 'keyboard_shortcut'
  | 'theme_dark' | 'theme_sepia' | 'theme_light' | 'theme_high_contrast'
  | 'library_multi_doc'
  | 'mindmap_depth_change'
  | 'bionic_toggle' | 'heatmap_toggle' | 'focus_mode_toggle' | 'auto_scroll_toggle'
  | 'reading_completed'
  | 'telemetry_declined'

interface TelemetryData {
  events: Record<string, number>
  firstSeen: number
  lastSeen: number
  sessionCount: number
}

// ─── PostHog init ──────────────────────────────────────────────────────────
let posthogReady = false

function initPostHog() {
  if (posthogReady) return
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return
  const host = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
  posthog.init(key, {
    api_host: host,
    autocapture: false,          // we control all events
    capture_pageview: false,     // SPA — we handle manually
    capture_pageleave: false,
    persistence: 'memory',       // no cookies, no localStorage from PostHog
    ip: false,                   // don't send IP
    disable_session_recording: true,
    loaded: () => { posthogReady = true },
  })
  posthogReady = true
}

// ─── Public API ────────────────────────────────────────────────────────────

export function isTelemetryEnabled(): boolean {
  return localStorage.getItem(TELEMETRY_ENABLED_KEY) === 'true'
}

export function hasBeenAsked(): boolean {
  return localStorage.getItem(TELEMETRY_ASKED_KEY) !== null
}

export function enableTelemetry(): void {
  localStorage.setItem(TELEMETRY_ENABLED_KEY, 'true')
  localStorage.setItem(TELEMETRY_ASKED_KEY, 'true')
  initPostHog()
  incrementSession()
}

export function disableTelemetry(): void {
  localStorage.setItem(TELEMETRY_ENABLED_KEY, 'false')
  localStorage.setItem(TELEMETRY_ASKED_KEY, 'true')
  // Fire one last event so we know how many users declined
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (key) {
    initPostHog()
    posthog.capture('telemetry_declined')
    // Reset PostHog to stop any further tracking
    setTimeout(() => posthog.reset(), 500)
  }
  trackLocal('telemetry_declined')
}

export function trackEvent(event: TelemetryEvent, properties?: Record<string, string | number | boolean>): void {
  if (!isTelemetryEnabled()) return
  trackLocal(event)
  trackRemote(event, properties)
}

export function incrementSession(): void {
  if (!isTelemetryEnabled()) return
  const data = getLocalData()
  data.sessionCount++
  data.lastSeen = Date.now()
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(data))
  trackRemote('session_start', { session_count: data.sessionCount })
}

/** User can export their own telemetry data */
export function exportTelemetry(): TelemetryData | null {
  const raw = localStorage.getItem(TELEMETRY_KEY)
  return raw ? JSON.parse(raw) : null
}

/** User can delete all telemetry data */
export function clearTelemetry(): void {
  localStorage.removeItem(TELEMETRY_KEY)
  if (posthogReady) posthog.reset()
}

/** List of all tracked events for transparency display */
export const TRACKED_EVENTS: { event: TelemetryEvent; description: string }[] = [
  { event: 'doc_opened', description: 'A document was opened' },
  { event: 'view_read', description: 'Reader view used' },
  { event: 'view_mindmap', description: 'Mind map view used' },
  { event: 'view_cards', description: 'Cards view used' },
  { event: 'view_treemap', description: 'Treemap view used' },
  { event: 'view_graph', description: 'Knowledge graph viewed' },
  { event: 'view_coach', description: 'Coach mode used' },
  { event: 'ai_chat', description: 'AI chat question asked' },
  { event: 'ai_summarize', description: 'AI summarize used' },
  { event: 'ai_explain', description: 'AI explain used' },
  { event: 'ai_coach', description: 'AI coach explanation loaded' },
  { event: 'ai_quiz', description: 'Coach quiz attempted' },
  { event: 'tts_play', description: 'Text-to-speech played' },
  { event: 'highlight_added', description: 'Text highlight added' },
  { event: 'comment_added', description: 'Comment added' },
  { event: 'export_chat', description: 'Chat exported as markdown' },
  { event: 'export_highlights', description: 'Highlights exported' },
  { event: 'export_pdf', description: 'Document printed/exported as PDF' },
  { event: 'keyboard_shortcut', description: 'Keyboard shortcut used' },
  { event: 'theme_dark', description: 'Dark theme selected' },
  { event: 'theme_sepia', description: 'Sepia theme selected' },
  { event: 'theme_light', description: 'Light theme selected' },
  { event: 'theme_high_contrast', description: 'High-contrast theme selected' },
  { event: 'library_multi_doc', description: 'Multiple documents in library' },
  { event: 'mindmap_depth_change', description: 'Mind map depth adjusted' },
  { event: 'bionic_toggle', description: 'Bionic reading toggled' },
  { event: 'heatmap_toggle', description: 'Word heatmap toggled' },
  { event: 'focus_mode_toggle', description: 'Focus mode toggled' },
  { event: 'auto_scroll_toggle', description: 'Auto-scroll toggled' },
  { event: 'reading_completed', description: 'Document fully read (100%)' },
]

// ─── Internal helpers ──────────────────────────────────────────────────────

function getLocalData(): TelemetryData {
  const raw = localStorage.getItem(TELEMETRY_KEY)
  return raw ? JSON.parse(raw) : { events: {}, firstSeen: Date.now(), lastSeen: Date.now(), sessionCount: 0 }
}

function trackLocal(event: string): void {
  const data = getLocalData()
  data.events[event] = (data.events[event] ?? 0) + 1
  data.lastSeen = Date.now()
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(data))
}

function trackRemote(event: string, properties?: Record<string, string | number | boolean>): void {
  if (!posthogReady) initPostHog()
  if (!posthogReady) return
  posthog.capture(event, properties)
}

// Auto-init PostHog if telemetry was previously enabled
if (isTelemetryEnabled()) {
  initPostHog()
}
