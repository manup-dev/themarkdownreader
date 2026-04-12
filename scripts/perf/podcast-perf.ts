/**
 * Podcast generation performance test.
 *
 * Measures:
 * - Heap memory (before, peak, after)
 * - Wall clock time per phase
 * - Main-thread blocking via Node's performance.eventLoopUtilization
 * - Correctness: output must parse and contain valid lines
 *
 * Run: docker compose exec app sh -c 'OLLAMA_URL=http://ollama:11434 npx tsx scripts/perf/podcast-perf.ts'
 *
 * Exit codes:
 *   0 = all tests passed within thresholds
 *   1 = threshold exceeded or test failed
 */

// Polyfill IndexedDB for Dexie — podcast.ts uses it for caching
import 'fake-indexeddb/auto'
// Polyfill crypto.subtle digest used by hashContent
import { webcrypto } from 'node:crypto'
if (!(globalThis as unknown as { crypto?: unknown }).crypto) {
  (globalThis as unknown as { crypto: unknown }).crypto = webcrypto
}
// Polyfill navigator for device-profile.ts
if (!(globalThis as unknown as { navigator?: unknown }).navigator) {
  (globalThis as unknown as { navigator: unknown }).navigator = {
    hardwareConcurrency: 8,
    deviceMemory: 16,
  }
}
// Polyfill localStorage for AI config — pre-seed Ollama URL from env
if (!(globalThis as unknown as { localStorage?: unknown }).localStorage) {
  const store = new Map<string, string>()
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  store.set('md-reader-ollama-url', ollamaUrl)
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  }
}

import { performance } from 'perf_hooks'
import { performance as perfHooks } from 'node:perf_hooks'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CORPUS_DIR = path.join(__dirname, '..', 'eval', 'test-corpus')

// ─── Test corpus: different sizes ─────────────────────────────────────────────

interface PerfTestCase {
  name: string
  markdown: string
  expectedMinLines: number
}

function loadCorpus(): PerfTestCase[] {
  const simple = fs.readFileSync(path.join(CORPUS_DIR, '01-simple.md'), 'utf-8')
  const complex = fs.readFileSync(path.join(CORPUS_DIR, '02-complex-technical.md'), 'utf-8')

  // Synthesize larger docs by repeating sections
  const medium = complex + '\n\n' + complex.replace(/^#/gm, '##') // ~4KB
  const large = Array(5).fill(complex).join('\n\n---\n\n')        // ~10KB
  const huge = Array(15).fill(complex).join('\n\n---\n\n')         // ~30KB

  return [
    { name: 'small (simple ~1KB)', markdown: simple, expectedMinLines: 6 },
    { name: 'medium (complex ~2KB)', markdown: complex, expectedMinLines: 6 },
    { name: 'large (4x complex ~10KB)', markdown: medium + '\n\n' + large, expectedMinLines: 6 },
    { name: 'huge (15x complex ~30KB)', markdown: huge, expectedMinLines: 6 },
  ]
}

// ─── Perf thresholds (fail test if exceeded) ──────────────────────────────────

const THRESHOLDS = {
  maxWallClockMs: 180_000,     // 3 minutes max per test
  maxHeapGrowthMB: 500,        // heap growth should stay bounded
  minLinesParsed: 6,           // at least 6 script lines in output
  maxEventLoopUtilization: 0.95, // event loop should not be fully saturated
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 * 10) / 10
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

function gcIfAvailable(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc
  if (g) g()
}

function captureMem(): { heapUsed: number; heapTotal: number; rss: number } {
  gcIfAvailable()
  const m = process.memoryUsage()
  return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss }
}

// ─── Main test runner ─────────────────────────────────────────────────────────

async function runTest(testCase: PerfTestCase): Promise<{
  passed: boolean
  wallClockMs: number
  heapBeforeMB: number
  heapPeakMB: number
  heapAfterMB: number
  heapGrowthMB: number
  linesGenerated: number
  eventLoopUtil: number
  issues: string[]
}> {
  const issues: string[] = []
  const memBefore = captureMem()
  const heapBefore = memBefore.heapUsed

  // Sample heap every 500ms during generation to capture peak
  let heapPeak = heapBefore
  const heapSampler = setInterval(() => {
    const cur = process.memoryUsage().heapUsed
    if (cur > heapPeak) heapPeak = cur
  }, 500)

  // Measure event loop utilization (what fraction of time was main thread busy?)
  const eluBefore = perfHooks.eventLoopUtilization()

  const startWall = performance.now()
  let lines = 0

  try {
    // Dynamically import the pipeline so each test gets fresh module state
    const { generatePodcast } = await import('../../src/lib/podcast.js')
    const result = await generatePodcast(
      testCase.markdown,
      `Test: ${testCase.name}`,
      (stage, pct) => {
        // Progress callback — check heap mid-flight
        const cur = process.memoryUsage().heapUsed
        if (cur > heapPeak) heapPeak = cur
        if (pct % 25 === 0) {
          process.stdout.write(`    [${pct}%] ${stage} heap=${mb(cur)}MB\n`)
        }
      },
      undefined,
      { duration: 'quick' },
    )
    lines = result.scriptLines.length
  } catch (err) {
    issues.push(`Generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const wallClockMs = performance.now() - startWall
  const eluAfter = perfHooks.eventLoopUtilization(eluBefore)
  clearInterval(heapSampler)

  gcIfAvailable()
  const memAfter = captureMem()
  const heapAfter = memAfter.heapUsed
  const heapGrowth = heapAfter - heapBefore

  // Threshold checks
  if (wallClockMs > THRESHOLDS.maxWallClockMs) {
    issues.push(`Wall clock ${formatMs(wallClockMs)} exceeds ${formatMs(THRESHOLDS.maxWallClockMs)}`)
  }
  if (mb(heapGrowth) > THRESHOLDS.maxHeapGrowthMB) {
    issues.push(`Heap growth ${mb(heapGrowth)}MB exceeds ${THRESHOLDS.maxHeapGrowthMB}MB`)
  }
  if (lines < testCase.expectedMinLines) {
    issues.push(`Only ${lines} lines generated, expected ≥${testCase.expectedMinLines}`)
  }
  if (eluAfter.utilization > THRESHOLDS.maxEventLoopUtilization) {
    issues.push(`Event loop ${(eluAfter.utilization * 100).toFixed(0)}% saturated, exceeds ${(THRESHOLDS.maxEventLoopUtilization * 100).toFixed(0)}%`)
  }

  return {
    passed: issues.length === 0,
    wallClockMs,
    heapBeforeMB: mb(heapBefore),
    heapPeakMB: mb(heapPeak),
    heapAfterMB: mb(heapAfter),
    heapGrowthMB: mb(heapGrowth),
    linesGenerated: lines,
    eventLoopUtil: eluAfter.utilization,
    issues,
  }
}

// ─── Memory leak stress test ──────────────────────────────────────────────────

async function runStressTest(iterations = 10): Promise<{
  passed: boolean
  heapSamples: number[]
  issues: string[]
}> {
  console.log(`\n\n🔥 Memory leak stress test (${iterations} iterations)`)
  console.log('  Running same pipeline repeatedly to detect memory retention...')

  const issues: string[] = []
  const heapSamples: number[] = []
  const { generatePodcast } = await import('../../src/lib/podcast.js')

  const simple = fs.readFileSync(path.join(CORPUS_DIR, '01-simple.md'), 'utf-8')

  // Warm-up run (load model, fill caches)
  await generatePodcast(simple, 'Warmup', undefined, undefined, { duration: 'quick' })
  gcIfAvailable()
  const baseline = process.memoryUsage().heapUsed
  heapSamples.push(baseline)

  for (let i = 0; i < iterations; i++) {
    // Use slightly different content each iteration to bypass cache
    const doc = simple + `\n\n## Iteration ${i}\nSome unique content for iteration ${i}.`
    await generatePodcast(doc, `Stress ${i}`, undefined, undefined, { duration: 'quick' })
    gcIfAvailable()
    const cur = process.memoryUsage().heapUsed
    heapSamples.push(cur)
    process.stdout.write(`    iter ${i + 1}/${iterations}: heap=${mb(cur)}MB (Δ${mb(cur - baseline)}MB from baseline)\n`)
  }

  // Calculate leak rate: regression slope of heap vs iteration
  const finalHeap = heapSamples[heapSamples.length - 1]
  const growthMB = mb(finalHeap - baseline)
  const leakPerIterationMB = growthMB / iterations

  console.log(`\n  Baseline heap: ${mb(baseline)}MB`)
  console.log(`  Final heap:    ${mb(finalHeap)}MB`)
  console.log(`  Total growth:  ${growthMB}MB over ${iterations} iterations`)
  console.log(`  Leak rate:     ${leakPerIterationMB.toFixed(2)}MB/iteration`)

  // Threshold: growth should be <5MB per iteration after warm-up (caches are ok)
  if (leakPerIterationMB > 5) {
    issues.push(`Potential memory leak: ${leakPerIterationMB.toFixed(2)}MB growth per iteration`)
  }

  // Also check if growth is monotonic (bad) vs noisy (normal GC)
  let monotonicIncreases = 0
  for (let i = 1; i < heapSamples.length; i++) {
    if (heapSamples[i] > heapSamples[i - 1]) monotonicIncreases++
  }
  const monotonicRatio = monotonicIncreases / (heapSamples.length - 1)
  if (monotonicRatio > 0.85) {
    issues.push(`Heap growth is monotonic (${(monotonicRatio * 100).toFixed(0)}% of iterations), indicating a leak`)
  }

  return {
    passed: issues.length === 0,
    heapSamples,
    issues,
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔬 Podcast Performance Test\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('  Thresholds:')
  console.log(`    Max wall clock:        ${formatMs(THRESHOLDS.maxWallClockMs)}`)
  console.log(`    Max heap growth:       ${THRESHOLDS.maxHeapGrowthMB}MB`)
  console.log(`    Min lines generated:   ${THRESHOLDS.minLinesParsed}`)
  console.log(`    Max event loop util:   ${(THRESHOLDS.maxEventLoopUtilization * 100).toFixed(0)}%`)
  console.log('')

  const testCases = loadCorpus()
  const results: Array<{ name: string; result: Awaited<ReturnType<typeof runTest>> }> = []

  for (const testCase of testCases) {
    const sizeKB = Math.round(testCase.markdown.length / 1024 * 10) / 10
    console.log(`\n📋 ${testCase.name} (${sizeKB}KB)`)
    console.log('  Running...')
    const result = await runTest(testCase)
    results.push({ name: testCase.name, result })
    const status = result.passed ? '✅ PASS' : '❌ FAIL'
    console.log(`  ${status}`)
    console.log(`    wall:          ${formatMs(result.wallClockMs)}`)
    console.log(`    heap before:   ${result.heapBeforeMB}MB`)
    console.log(`    heap peak:     ${result.heapPeakMB}MB`)
    console.log(`    heap after:    ${result.heapAfterMB}MB`)
    console.log(`    heap growth:   ${result.heapGrowthMB}MB`)
    console.log(`    lines:         ${result.linesGenerated}`)
    console.log(`    evt loop util: ${(result.eventLoopUtil * 100).toFixed(1)}%`)
    if (result.issues.length > 0) {
      console.log(`    issues:`)
      for (const issue of result.issues) console.log(`      ⚠ ${issue}`)
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📊 SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  const passed = results.filter(r => r.result.passed).length
  console.log(`  ${passed}/${results.length} tests passed\n`)
  console.log('  Size vs Perf:')
  for (const { name, result } of results) {
    console.log(`    ${name.padEnd(35)} wall=${formatMs(result.wallClockMs).padStart(6)} heap+=${String(result.heapGrowthMB).padStart(5)}MB util=${(result.eventLoopUtil * 100).toFixed(0)}%`)
  }

  // Run stress test for memory leak detection
  const stress = await runStressTest(10)
  const stressStatus = stress.passed ? '✅ PASS' : '❌ FAIL'
  console.log(`\n  Stress test: ${stressStatus}`)
  if (stress.issues.length > 0) {
    for (const issue of stress.issues) console.log(`    ⚠ ${issue}`)
  }

  const totalFailed = (results.length - passed) + (stress.passed ? 0 : 1)
  process.exit(totalFailed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
