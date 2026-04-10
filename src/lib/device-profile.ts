/**
 * Device capability profiler — detects hardware and maps to podcast generation presets.
 *
 * Tiers:
 *   high   — Desktop with GPU (Ollama/RTX), 16GB+ RAM, 8+ cores
 *   medium — Laptop with decent specs (M1/M2 Pro, 16GB, or cloud backend)
 *   low    — Low-RAM device (M2 Air 8GB, older laptop, browser-only model)
 *   minimal — Very constrained (≤4GB RAM, mobile, or no capable backend)
 *
 * Each tier maps to generation presets that keep the SLM in its sweet spot
 * while maximizing quality for the device's capability.
 */

import { getActiveBackend } from './ai'

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeviceTier = 'high' | 'medium' | 'low' | 'minimal'

export interface DeviceCapabilities {
  memoryGB: number | null    // navigator.deviceMemory (Chrome) or null
  cpuCores: number           // navigator.hardwareConcurrency
  hasWebGPU: boolean
  backend: string            // active AI backend
  tier: DeviceTier
}

export interface PodcastPreset {
  // Content planning
  themesQuick: number
  themesDetailed: number
  exchangesPerThemeQuick: number
  exchangesPerThemeDetailed: number

  // Token budgets (per theme)
  maxTokensQuick: number
  maxTokensDetailed: number

  // Pipeline features
  enableDramatize: boolean       // post-processing dramatize pass
  enableSlidingWindow: boolean   // sequential with cross-theme context
  enableDeduplication: boolean   // post-gen dedup
  enableTransitions: boolean     // programmatic transitions
  parallelBatchSize: number      // how many themes to generate in parallel

  // LLM parameters
  scriptTemperature: number
  dramatizeTemperature: number
}

// ─── Preset Definitions ─────────────────────────────────────────────────────

const PRESETS: Record<DeviceTier, PodcastPreset> = {
  high: {
    // Desktop with Ollama + GPU — full pipeline, max quality
    themesQuick: 2,
    themesDetailed: 5,
    exchangesPerThemeQuick: 8,
    exchangesPerThemeDetailed: 10,
    maxTokensQuick: 800,
    maxTokensDetailed: 800,
    enableDramatize: true,
    enableSlidingWindow: true,
    enableDeduplication: true,
    enableTransitions: true,
    parallelBatchSize: 2,
    scriptTemperature: 0.45,
    dramatizeTemperature: 0.65,
  },

  medium: {
    // Good laptop or cloud backend — most features, moderate scale
    themesQuick: 2,
    themesDetailed: 4,
    exchangesPerThemeQuick: 6,
    exchangesPerThemeDetailed: 10,
    maxTokensQuick: 800,
    maxTokensDetailed: 800,
    enableDramatize: true,
    enableSlidingWindow: true,
    enableDeduplication: true,
    enableTransitions: true,
    parallelBatchSize: 2,
    scriptTemperature: 0.45,
    dramatizeTemperature: 0.65,
  },

  low: {
    // M2 Air 8GB, browser model, or weak cloud — reduced scale, skip expensive passes
    themesQuick: 1,
    themesDetailed: 3,
    exchangesPerThemeQuick: 6,
    exchangesPerThemeDetailed: 8,
    maxTokensQuick: 600,
    maxTokensDetailed: 800,
    enableDramatize: false,       // skip — saves an LLM call per 12 exchanges
    enableSlidingWindow: true,
    enableDeduplication: true,
    enableTransitions: true,
    parallelBatchSize: 1,         // sequential — don't overload the device
    scriptTemperature: 0.40,
    dramatizeTemperature: 0.60,
  },

  minimal: {
    // Very constrained — shortest possible podcast, no extras
    themesQuick: 1,
    themesDetailed: 2,
    exchangesPerThemeQuick: 4,
    exchangesPerThemeDetailed: 6,
    maxTokensQuick: 500,
    maxTokensDetailed: 600,
    enableDramatize: false,
    enableSlidingWindow: false,   // keep parallel for speed
    enableDeduplication: true,
    enableTransitions: true,
    parallelBatchSize: 1,
    scriptTemperature: 0.35,
    dramatizeTemperature: 0.60,
  },
}

// ─── Detection ──────────────────────────────────────────────────────────────

let cachedProfile: DeviceCapabilities | null = null

function detectMemoryGB(): number | null {
  const nav = navigator as unknown as { deviceMemory?: number }
  return nav.deviceMemory ?? null
}

function detectCPUCores(): number {
  return navigator.hardwareConcurrency ?? 4
}

function detectWebGPU(): boolean {
  const nav = navigator as unknown as { gpu?: unknown }
  return !!nav.gpu
}

function classifyTier(mem: number | null, cores: number, hasGPU: boolean, backend: string): DeviceTier {
  // Ollama = local GPU server — high tier regardless of browser capabilities
  if (backend === 'ollama') {
    return (mem ?? 16) >= 16 ? 'high' : 'medium'
  }

  // OpenRouter = cloud — medium tier (backend is fast, device doesn't matter much)
  if (backend === 'openrouter') {
    return 'medium'
  }

  // Browser-based inference — tier depends on device hardware
  if (mem !== null) {
    if (mem >= 16 && cores >= 8 && hasGPU) return 'high'
    if (mem >= 8 && cores >= 4) return 'medium'
    if (mem >= 4) return 'low'
    return 'minimal'
  }

  // deviceMemory not available (Firefox/Safari) — estimate from cores
  if (cores >= 10 && hasGPU) return 'high'
  if (cores >= 6) return 'medium'
  if (cores >= 4) return 'low'
  return 'minimal'
}

/**
 * Detect device capabilities and classify into a tier.
 * Cached after first call — hardware doesn't change during a session.
 * Call `resetDeviceProfile()` if the backend changes.
 */
export function getDeviceProfile(): DeviceCapabilities {
  if (cachedProfile) return cachedProfile

  const memoryGB = detectMemoryGB()
  const cpuCores = detectCPUCores()
  const hasWebGPU = detectWebGPU()
  const backend = getActiveBackend()
  const tier = classifyTier(memoryGB, cpuCores, hasWebGPU, backend)

  cachedProfile = { memoryGB, cpuCores, hasWebGPU, backend, tier }
  return cachedProfile
}

/** Reset cached profile (e.g. when user changes backend in settings). */
export function resetDeviceProfile(): void {
  cachedProfile = null
}

/**
 * Get podcast generation preset for the current device.
 * This is the main API — call from podcast.ts to get adaptive settings.
 */
export function getPodcastPreset(): PodcastPreset {
  const { tier } = getDeviceProfile()
  return PRESETS[tier]
}

/** Expose for debugging / UI display */
export function getDeviceTier(): DeviceTier {
  return getDeviceProfile().tier
}
