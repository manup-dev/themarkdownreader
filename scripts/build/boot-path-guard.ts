// Build guard: fail when a heavy lazy-feature chunk becomes part of the
// entry's static import graph (the "boot path" every first visit downloads).
//
// This is how a chunking regression shows up: a codeSplitting group that
// captures a shared dependency (e.g. React hoisted into the excalidraw vendor
// chunk) makes the entry statically import the whole group. Nothing else
// breaks, the app just gets multi-MB slower to open. Used by both the web and
// the JupyterLab builds (see scripts/build/chunk-groups.ts).

import type { Plugin } from 'vite'
import { bundleEntries, fileStem, staticClosure, type PrecacheBundleEntry } from './sw-precache'

/** Heavy chunks only lazy features (diagrams, mind map, AI, TTS) need. */
export const DEFAULT_BOOT_FORBIDDEN_STEMS = [
  'excalidraw', 'mermaid', 'markmap', 'd3', 'webllm', 'transformers', 'tts-worker', 'kokoro',
]

/** Boot-path files (entry static closure) whose stem is forbidden there. */
export function bootPathViolations(entries: PrecacheBundleEntry[], forbiddenStems: string[]): string[] {
  const forbidden = new Set(forbiddenStems)
  return [...staticClosure(entries)].filter((f) => forbidden.has(fileStem(f))).sort()
}

export function bootPathGuardPlugin(forbiddenStems: string[] = DEFAULT_BOOT_FORBIDDEN_STEMS): Plugin {
  return {
    name: 'md-reader-boot-path-guard',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const violations = bootPathViolations(bundleEntries(bundle), forbiddenStems)
      if (violations.length) {
        this.error(`lazy-feature chunks are statically imported by the entry (boot path): ${violations.join(', ')}. `
          + 'A codeSplitting group probably captured a shared dependency (e.g. React); see scripts/build/chunk-groups.ts.')
      }
    },
  }
}
