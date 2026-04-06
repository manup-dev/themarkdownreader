import { db } from './docstore'

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_STORAGE_MB = 80
export const COLLECTION_CACHE_MAX_MB = 30
const EVICTION_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// ─── Storage budget ──────────────────────────────────────────────────────────

export async function checkStorageBudget(): Promise<{ usedMB: number; budgetMB: number; ok: boolean }> {
  if (!navigator.storage?.estimate) {
    return { usedMB: 0, budgetMB: MAX_STORAGE_MB, ok: true }
  }
  const est = await navigator.storage.estimate()
  const usedMB = (est.usage ?? 0) / (1024 * 1024)
  return { usedMB, budgetMB: MAX_STORAGE_MB, ok: usedMB < MAX_STORAGE_MB }
}

// ─── Storage breakdown ───────────────────────────────────────────────────────

export async function getStorageBreakdown(): Promise<{
  documents: number
  analyses: number
  podcasts: number
  searchIndex: number
  collections: number
  totalMB: number
}> {
  const budget = await checkStorageBudget()
  const docCount = await db.documents.count()
  const chunkCount = await db.chunks.count()
  const analysisCount = await db.documentAnalyses.count()
  const podcastCount = await db.podcastScripts.count()
  const searchCount = await db.searchCache.count()
  const collectionCount = await db.collectionCache.count()

  return {
    documents: (docCount * 30 + chunkCount * 2) / 1024,
    analyses: (analysisCount * 4) / 1024,
    podcasts: (podcastCount * 10) / 1024,
    searchIndex: (searchCount * 50) / 1024,
    collections: (collectionCount * 500) / 1024,
    totalMB: budget.usedMB,
  }
}

// ─── Auto-eviction ───────────────────────────────────────────────────────────

export async function runEviction(): Promise<{ evicted: string[] }> {
  const evicted: string[] = []
  const cutoff = Date.now() - EVICTION_AGE_MS

  const oldPodcasts = await db.podcastScripts.where('createdAt').below(cutoff).toArray()
  if (oldPodcasts.length > 0) {
    await db.podcastScripts.where('createdAt').below(cutoff).delete()
    evicted.push(`${oldPodcasts.length} old podcast scripts`)
  }

  let budget = await checkStorageBudget()
  if (budget.ok) return { evicted }

  const oldTraining = await db.trainingData.where('timestamp').below(cutoff).toArray()
  if (oldTraining.length > 0) {
    await db.trainingData.where('timestamp').below(cutoff).delete()
    evicted.push(`${oldTraining.length} old training datapoints`)
  }

  budget = await checkStorageBudget()
  if (budget.ok) return { evicted }

  const oldAnalyses = await db.documentAnalyses.where('analyzedAt').below(cutoff).toArray()
  if (oldAnalyses.length > 0) {
    await db.documentAnalyses.where('analyzedAt').below(cutoff).delete()
    evicted.push(`${oldAnalyses.length} old document analyses`)
  }

  return { evicted }
}

// ─── Pre-write check ─────────────────────────────────────────────────────────

export async function ensureStorageBudget(): Promise<boolean> {
  let budget = await checkStorageBudget()
  if (budget.ok) return true

  await runEviction()
  budget = await checkStorageBudget()

  if (!budget.ok) {
    const toast = document.createElement('div')
    toast.className = 'toast-notify'
    toast.textContent = 'Storage full — clear old podcasts in Settings'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 5000)
    return false
  }

  return true
}

// ─── Performance monitoring ──────────────────────────────────────────────────

export function checkPerformance(): { heapMB: number; ok: boolean } {
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } }
  if (!perf.memory) return { heapMB: 0, ok: true }
  const heapMB = perf.memory.usedJSHeapSize / (1024 * 1024)
  return { heapMB, ok: heapMB < 350 }
}
