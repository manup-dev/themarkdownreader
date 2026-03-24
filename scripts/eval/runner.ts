/**
 * md-reader Evaluation System
 *
 * Comprehensive accuracy testing across all features:
 * 1. Deterministic tests (TOC extraction, stats, link detection)
 * 2. AI quality tests (summarization, Q&A, knowledge graph)
 * 3. Visual tests (screenshot comparison, readability)
 * 4. Cross-document tests (collection links, cross-doc Q&A)
 *
 * Uses: Playwright for browser automation + screenshots,
 *        Ollama/OpenRouter as AI-judge for qualitative evaluation
 *
 * Run: npx tsx scripts/eval/runner.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// const BASE_URL = process.env.EVAL_URL || 'http://localhost:5183' // reserved for future browser-based evals
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11435'
const RESULTS_DIR = path.join(__dirname, 'results')
const CORPUS_DIR = path.join(__dirname, 'test-corpus')
const GROUND_TRUTH = JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-truth.json'), 'utf-8'))

interface EvalResult {
  id: string
  feature: string
  passed: boolean
  score: number  // 0-100
  details: string
  screenshot?: string
  duration: number
}

const results: EvalResult[] = []

// ─── Deterministic Tests ───────────────────────────────────────────────────

async function evalTocExtraction(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const { extractToc } = await import('../../src/lib/markdown')
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const toc = extractToc(md)
  const expected = testCase.expected as Record<string, unknown>

  let score = 100
  const issues: string[] = []

  // Check heading count
  if (expected.headingCount && toc.length !== expected.headingCount) {
    score -= 20
    issues.push(`Expected ${expected.headingCount} headings, got ${toc.length}`)
  }

  // Check H1 count
  const h1s = toc.filter((t) => t.level === 1)
  if (expected.h1Count && h1s.length !== expected.h1Count) {
    score -= 15
    issues.push(`Expected ${expected.h1Count} H1s, got ${h1s.length}`)
  }

  // Check specific headings exist
  if (expected.headings) {
    const tocTexts = toc.map((t) => t.text)
    for (const h of expected.headings as string[]) {
      if (!tocTexts.includes(h)) {
        score -= 10
        issues.push(`Missing heading: "${h}"`)
      }
    }
  }

  return {
    id: testCase.id as string,
    feature: 'toc-extraction',
    passed: score >= 80,
    score: Math.max(0, score),
    details: issues.length > 0 ? issues.join('; ') : 'All headings extracted correctly',
    duration: Date.now() - start,
  }
}

async function evalDocumentStats(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const { wordCount, estimateReadingTime, estimateDifficulty } = await import('../../src/lib/markdown')
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>

  let score = 100
  const issues: string[] = []

  const wc = wordCount(md)
  const range = expected.wordCountRange as number[]
  if (range && (wc < range[0] || wc > range[1])) {
    score -= 20
    issues.push(`Word count ${wc} outside range [${range[0]}, ${range[1]}]`)
  }

  if (expected.difficulty) {
    const diff = estimateDifficulty(md)
    if (diff !== expected.difficulty) {
      score -= 25
      issues.push(`Difficulty: expected "${expected.difficulty}", got "${diff}"`)
    }
  }

  if (expected.readingTimeMinutes) {
    const rt = estimateReadingTime(md)
    if (rt !== expected.readingTimeMinutes) {
      score -= 10
      issues.push(`Reading time: expected ${expected.readingTimeMinutes}m, got ${rt}m`)
    }
  }

  return {
    id: testCase.id as string,
    feature: 'document-stats',
    passed: score >= 70,
    score: Math.max(0, score),
    details: issues.length > 0 ? issues.join('; ') : 'All stats correct',
    duration: Date.now() - start,
  }
}

async function evalCollectionLinks(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const { buildCollection } = await import('../../src/lib/collection')
  const files = (testCase.files as string[]).map((f) => ({
    path: f,
    content: fs.readFileSync(path.join(CORPUS_DIR, f), 'utf-8'),
  }))

  const collection = buildCollection(files, 'test-collection')
  const expected = testCase.expected as Record<string, unknown>

  let score = 100
  const issues: string[] = []

  if (collection.files.length !== expected.totalFiles) {
    score -= 20
    issues.push(`Expected ${expected.totalFiles} files, got ${collection.files.length}`)
  }

  if (expected.structure && collection.structure !== expected.structure) {
    score -= 15
    issues.push(`Expected structure "${expected.structure}", got "${collection.structure}"`)
  }

  // Check link discovery
  const totalLinks = collection.links.length
  if (expected.totalLinks && Math.abs(totalLinks - (expected.totalLinks as number)) > 2) {
    score -= 10
    issues.push(`Expected ~${expected.totalLinks} links, got ${totalLinks}`)
  }

  // Check specific links
  for (const [key, expectedTargets] of Object.entries(expected)) {
    if (key.startsWith('linksFrom')) {
      const sourceSuffix = key.replace('linksFrom', '').toLowerCase()
      const sourceFile = collection.files.find((f) => f.path.toLowerCase().includes(sourceSuffix))
      if (sourceFile) {
        for (const target of expectedTargets as string[]) {
          const hasLink = sourceFile.linksTo.some((l) => l.includes(target.replace('./', '')))
          if (!hasLink) {
            score -= 5
            issues.push(`Missing link from ${sourceFile.path} to ${target}`)
          }
        }
      }
    }
  }

  return {
    id: testCase.id as string,
    feature: 'collection-links',
    passed: score >= 70,
    score: Math.max(0, score),
    details: issues.length > 0 ? issues.join('; ') : `All ${totalLinks} links discovered correctly`,
    duration: Date.now() - start,
  }
}

// ─── AI Quality Tests (uses Ollama as judge) ───────────────────────────────

// Keep model warm between eval calls
async function keepWarm() {
  try {
    await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5:1.5b', messages: [{ role: 'user', content: 'ok' }], stream: false, keep_alive: '60m' }),
      signal: AbortSignal.timeout(90000),
    })
  } catch { /* ignore */ }
}

async function aiJudge(prompt: string): Promise<{ score: number; reasoning: string }> {
  try {
    await keepWarm() // Ensure model is loaded before judging
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: 'You are an evaluation judge. Score the quality on a scale of 0-100. Respond with ONLY valid JSON: {"score": N, "reasoning": "..."}' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        keep_alive: '60m',
        options: { temperature: 0.1, num_predict: 128 },
      }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    const content = data.message?.content ?? ''
    const match = content.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    return { score: 50, reasoning: 'Could not parse judge response' }
  } catch {
    return { score: 0, reasoning: 'AI judge unavailable' }
  }
}

async function evalSummarization(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>

  // Generate summary via Ollama
  let summary = ''
  try {
    // Import prompts from prompts.ts (no Vite deps, safe for Node)
    const { PROMPTS, PROMPT_CONFIG } = await import('../../src/lib/prompts')
    await keepWarm()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: PROMPTS.summarize },
          { role: 'user', content: md.slice(0, PROMPT_CONFIG.summarizeMaxInput) },
        ],
        stream: false,
        keep_alive: '60m',
        options: { temperature: PROMPT_CONFIG.temperature, num_predict: PROMPT_CONFIG.maxTokens },
      }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    summary = data.message?.content ?? ''
  } catch (err) {
    return { id: testCase.id as string, feature: 'ai-summarization', passed: false, score: 0, details: `Ollama error: ${err instanceof Error ? err.message : String(err)}`, duration: Date.now() - start }
  }

  let score = 100
  const issues: string[] = []

  // Check must-mention terms
  if (expected.mustMention) {
    for (const term of expected.mustMention as string[]) {
      if (!summary.toLowerCase().includes(term.toLowerCase())) {
        score -= 15
        issues.push(`Summary missing key term: "${term}"`)
      }
    }
  }

  // Check must-not-mention (hallucination detection)
  if (expected.mustNotMention) {
    for (const term of expected.mustNotMention as string[]) {
      if (summary.toLowerCase().includes(term.toLowerCase())) {
        score -= 20
        issues.push(`Summary hallucinated term: "${term}"`)
      }
    }
  }

  // Length check
  if (expected.maxLength && summary.length > (expected.maxLength as number)) {
    score -= 10
    issues.push(`Summary too long: ${summary.length} chars (max ${expected.maxLength})`)
  }

  // AI judge for overall quality (weighted 20% — small model judge is too harsh on complex docs)
  const judge = await aiJudge(
    `Rate this summary of a document. Is it faithful and complete? Score 0-100.\n\nDocument start: ${md.slice(0, 300)}\n\nSummary: ${summary}`
  )
  score = Math.round(score * 0.8 + judge.score * 0.2)

  return {
    id: testCase.id as string,
    feature: 'ai-summarization',
    passed: score >= 60,
    score: Math.max(0, score),
    details: issues.length > 0 ? `${issues.join('; ')}. Judge: ${judge.reasoning}` : `Judge: ${judge.reasoning}`,
    duration: Date.now() - start,
  }
}

// ─── AI Q&A Tests ─────────────────────────────────────────────────────────

async function evalQA(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const questions = testCase.questions as Array<{ question: string; expectedAnswer?: string; answerMustContain: string[] }>

  const { PROMPTS, PROMPT_CONFIG } = await import('../../src/lib/prompts')
  const { chunkMarkdown } = await import('../../src/lib/markdown')

  const chunks = chunkMarkdown(md)
  const context = chunks.map((c, i) => `[${i + 1}] ${c.sectionPath}\n${c.text}`).join('\n\n').slice(0, PROMPT_CONFIG.qaMaxChunkLen * chunks.length)

  let totalScore = 0
  const issues: string[] = []

  for (const q of questions) {
    try {
      await keepWarm()
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [
            { role: 'system', content: PROMPTS.askDocument },
            { role: 'user', content: `Context:\n${context}\n\nQuestion: ${q.question}` },
          ],
          stream: false,
          keep_alive: '60m',
          options: { temperature: PROMPT_CONFIG.temperature, num_predict: PROMPT_CONFIG.maxTokens },
        }),
        signal: AbortSignal.timeout(120000),
      })
      const data = await res.json()
      const answer = (data.message?.content ?? '').toLowerCase()

      let qScore = 100
      for (const term of q.answerMustContain) {
        if (!answer.includes(term.toLowerCase())) {
          qScore -= Math.floor(80 / q.answerMustContain.length)
          issues.push(`Q: "${q.question}" — missing "${term}"`)
        }
      }

      // Check it doesn't say "not found" when we expect an answer
      if (answer.includes('not found') || answer.includes('not in the document')) {
        qScore = Math.min(qScore, 20)
        issues.push(`Q: "${q.question}" — model claimed answer not found`)
      }

      totalScore += qScore
    } catch (err) {
      issues.push(`Q: "${q.question}" — Ollama error: ${err instanceof Error ? err.message : String(err)}`)
      totalScore += 0
    }
  }

  const avgScore = Math.round(totalScore / questions.length)
  return {
    id: testCase.id as string,
    feature: 'ai-qa',
    passed: avgScore >= 60,
    score: Math.max(0, avgScore),
    details: issues.length > 0 ? issues.join('; ') : `All ${questions.length} Q&A answers correct`,
    duration: Date.now() - start,
  }
}

// ─── Knowledge Graph Extraction Tests ─────────────────────────────────────

async function evalKnowledgeGraph(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>

  const { PROMPTS, PROMPT_CONFIG } = await import('../../src/lib/prompts')

  let graphJson = ''
  try {
    await keepWarm()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: PROMPTS.extractConcepts },
          { role: 'user', content: md.slice(0, PROMPT_CONFIG.conceptsMaxInput) },
        ],
        stream: false,
        keep_alive: '60m',
        options: { temperature: 0.1, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    graphJson = data.message?.content ?? ''
  } catch (err) {
    return { id: testCase.id as string, feature: 'knowledge-graph', passed: false, score: 0, details: `Ollama error: ${err instanceof Error ? err.message : String(err)}`, duration: Date.now() - start }
  }

  // Parse JSON from response — fall back to deterministic extraction (matching app behavior)
  let graph: { nodes?: Array<{ id: string; label: string }>; edges?: Array<{ source: string; target: string }> } = { nodes: [], edges: [] }
  const jsonMatch = graphJson.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.nodes?.length >= 3) graph = parsed
    } catch { /* fall through to deterministic */ }
  }

  // Deterministic fallback: extract from markdown syntax (same as app)
  if (!graph.nodes || graph.nodes.length < 3) {
    const nodes: Array<{ id: string; label: string }> = []
    const seen = new Set<string>()
    const headings = md.match(/^#{1,3}\s+(.+)$/gm) ?? []
    for (const h of headings) {
      const label = h.replace(/^#+\s+/, '').trim()
      const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
      if (!seen.has(id) && label.length > 2 && label.length < 60) { seen.add(id); nodes.push({ id, label }) }
    }
    const bolded = md.match(/\*\*([^*]+)\*\*/g) ?? []
    for (const b of bolded) {
      const label = b.replace(/\*\*/g, '').trim()
      const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
      if (!seen.has(id) && label.length > 2 && label.length < 40) { seen.add(id); nodes.push({ id, label }) }
    }
    const edges: Array<{ source: string; target: string }> = []
    const limited = nodes.slice(0, 12)
    const sections = md.split(/^#{1,3}\s+/m).filter(Boolean)
    for (const section of sections) {
      const sl = section.toLowerCase()
      const present = limited.filter((n) => sl.includes(n.label.toLowerCase()))
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length && edges.length < 20; j++) {
          edges.push({ source: present[i].id, target: present[j].id })
        }
      }
    }
    graph = { nodes: limited, edges }
  }

  let score = 100
  const issues: string[] = []
  const nodes = graph.nodes ?? []
  const edges = graph.edges ?? []

  // Check node count
  if (expected.minNodeCount && nodes.length < (expected.minNodeCount as number)) {
    score -= 15
    issues.push(`Expected ≥${expected.minNodeCount} nodes, got ${nodes.length}`)
  }

  // Check edge count
  if (expected.minEdgeCount && edges.length < (expected.minEdgeCount as number)) {
    score -= 15
    issues.push(`Expected ≥${expected.minEdgeCount} edges, got ${edges.length}`)
  }

  // Check must-extract entities (F1-style: recall)
  if (expected.mustExtractEntities) {
    const nodeLabels = nodes.map((n) => (n.label ?? n.id ?? '').toLowerCase())
    let found = 0
    for (const entity of expected.mustExtractEntities as string[]) {
      const entityLower = entity.toLowerCase()
      if (nodeLabels.some((l) => l.includes(entityLower) || entityLower.includes(l))) {
        found++
      } else {
        issues.push(`Missing entity: "${entity}"`)
      }
    }
    const recall = found / (expected.mustExtractEntities as string[]).length
    // Weight recall heavily (up to 50 points)
    score = Math.min(score, Math.round(50 + recall * 50))
  }

  return {
    id: testCase.id as string,
    feature: 'knowledge-graph',
    passed: score >= 60,
    score: Math.max(0, score),
    details: issues.length > 0 ? `${nodes.length} nodes, ${edges.length} edges. ${issues.join('; ')}` : `${nodes.length} nodes, ${edges.length} edges — all expected entities found`,
    duration: Date.now() - start,
  }
}

// ─── Coach Explanation Tests ──────────────────────────────────────────────

async function evalCoach(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>

  const { PROMPTS, PROMPT_CONFIG } = await import('../../src/lib/prompts')

  let explanation = ''
  try {
    await keepWarm()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: PROMPTS.coach },
          { role: 'user', content: md.slice(0, PROMPT_CONFIG.coachMaxInput) },
        ],
        stream: false,
        keep_alive: '60m',
        options: { temperature: PROMPT_CONFIG.temperature, num_predict: PROMPT_CONFIG.maxTokens },
      }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    explanation = data.message?.content ?? ''
  } catch (err) {
    return { id: testCase.id as string, feature: 'coach-explanation', passed: false, score: 0, details: `Ollama error: ${err instanceof Error ? err.message : String(err)}`, duration: Date.now() - start }
  }

  let score = 100
  const issues: string[] = []
  const lower = explanation.toLowerCase()

  // Check uses analogy (look for analogy markers)
  if (expected.usesAnalogy) {
    const hasAnalogy = /like |similar to |think of |imagine |just as |analogy|metaphor|compare/i.test(explanation)
    if (!hasAnalogy) {
      score -= 20
      issues.push('No analogy detected')
    }
  }

  // Check asks questions
  if (expected.asksQuestions) {
    if (!explanation.includes('?')) {
      score -= 20
      issues.push('No question found')
    }
  }

  // Check references doc content
  if (expected.referencesDocContent) {
    // Should mention at least some terms from the document
    const docTerms = ['raft', 'consensus', 'leader', 'node', 'distributed', 'paxos', 'fault']
    const mentioned = docTerms.filter((t) => lower.includes(t))
    if (mentioned.length < 2) {
      score -= 20
      issues.push(`Only references ${mentioned.length} doc terms`)
    }
  }

  // Check length (should be concise, under ~150 words)
  const wordLen = explanation.split(/\s+/).length
  if (wordLen > 200) {
    score -= 10
    issues.push(`Too verbose: ${wordLen} words`)
  }

  // AI judge for overall quality (weighted 30% — small model judge varies ±20pts)
  const judge = await aiJudge(
    `Rate this explanation of a technical topic. Is it clear, does it use an analogy, and does it ask a question? Score 0-100.\n\nExplanation: ${explanation}`
  )
  score = Math.round(score * 0.7 + judge.score * 0.3)

  return {
    id: testCase.id as string,
    feature: 'coach-explanation',
    passed: score >= 60,
    score: Math.max(0, score),
    details: issues.length > 0 ? `${issues.join('; ')}. Judge: ${judge.reasoning}` : `Judge: ${judge.reasoning}`,
    duration: Date.now() - start,
  }
}

// ─── Cross-Document Q&A Tests ─────────────────────────────────────────────

async function evalCrossDocQA(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const files = (testCase.files as string[]).map((f) => ({
    name: f,
    content: fs.readFileSync(path.join(CORPUS_DIR, f), 'utf-8'),
  }))
  const questions = testCase.questions as Array<{ question: string; answerMustContain: string[] }>

  const { PROMPTS, PROMPT_CONFIG } = await import('../../src/lib/prompts')

  // Combine all files as context
  const context = files.map((f, i) => `[Doc ${i + 1}: ${f.name}]\n${f.content.slice(0, 800)}`).join('\n\n')

  let totalScore = 0
  const issues: string[] = []

  for (const q of questions) {
    try {
      await keepWarm()
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [
            { role: 'system', content: PROMPTS.askDocument },
            { role: 'user', content: `Context:\n${context}\n\nQuestion: ${q.question}` },
          ],
          stream: false,
          keep_alive: '60m',
          options: { temperature: PROMPT_CONFIG.temperature, num_predict: PROMPT_CONFIG.maxTokens },
        }),
        signal: AbortSignal.timeout(120000),
      })
      const data = await res.json()
      const answer = (data.message?.content ?? '').toLowerCase()

      let qScore = 100
      for (const term of q.answerMustContain) {
        if (!answer.includes(term.toLowerCase())) {
          qScore -= Math.floor(80 / q.answerMustContain.length)
          issues.push(`Q: "${q.question}" — missing "${term}"`)
        }
      }
      totalScore += qScore
    } catch (err) {
      issues.push(`Q: "${q.question}" — error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const avgScore = Math.round(totalScore / questions.length)
  return {
    id: testCase.id as string,
    feature: 'cross-document-qa',
    passed: avgScore >= 60,
    score: Math.max(0, avgScore),
    details: issues.length > 0 ? issues.join('; ') : `All ${questions.length} cross-doc Q&A answers correct`,
    duration: Date.now() - start,
  }
}

// ─── Mind Map Structure Tests (deterministic) ─────────────────────────────

async function evalMindMap(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const { extractToc } = await import('../../src/lib/markdown')
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>
  const toc = extractToc(md)

  let score = 100
  const issues: string[] = []

  // Check root node (first H1)
  if (expected.rootNodeText) {
    const h1 = toc.find((t) => t.level === 1)
    if (!h1 || h1.text !== expected.rootNodeText) {
      score -= 20
      issues.push(`Root node: expected "${expected.rootNodeText}", got "${h1?.text ?? 'none'}"`)
    }
  }

  // Check branch count (H2 count = branches)
  if (expected.branchCount) {
    const h2s = toc.filter((t) => t.level === 2)
    if (h2s.length !== expected.branchCount) {
      score -= 15
      issues.push(`Branches: expected ${expected.branchCount}, got ${h2s.length}`)
    }
  }

  // Check max depth
  if (expected.maxDepth) {
    const maxLevel = Math.max(...toc.map((t) => t.level))
    if (maxLevel !== expected.maxDepth) {
      score -= 10
      issues.push(`Max depth: expected ${expected.maxDepth}, got ${maxLevel}`)
    }
  }

  return {
    id: testCase.id as string,
    feature: 'mindmap-visual',
    passed: score >= 70,
    score: Math.max(0, score),
    details: issues.length > 0 ? issues.join('; ') : 'Mind map structure correct',
    duration: Date.now() - start,
  }
}

// ─── TTS Narration Tests (deterministic) ──────────────────────────────────

async function evalTts(testCase: Record<string, unknown>): Promise<EvalResult> {
  const start = Date.now()
  const md = fs.readFileSync(path.join(CORPUS_DIR, testCase.file as string), 'utf-8')
  const expected = testCase.expected as Record<string, unknown>

  // Import the TTS text processing function
  const { markdownToSpeechSegments } = await import('../../src/lib/tts')
  const sections = markdownToSpeechSegments(md)
  const allSegments = sections.flat()
  const allText = allSegments.map((s) => s.text).join(' ').toLowerCase()

  let score = 100
  const issues: string[] = []

  // Check announces headings
  if (expected.announcesHeadings) {
    const hasHeadingAnnounce = allText.includes('titled') || allText.includes('section') || allText.includes('topic')
    if (!hasHeadingAnnounce) {
      score -= 20
      issues.push('TTS does not announce headings')
    }
  }

  // Check skips code blocks (should describe, not read raw code)
  if (expected.skipsCodeBlocks) {
    const hasCodeDesc = allText.includes('code example') || allText.includes('code block')
    const hasRawCode = allText.includes('function ') || allText.includes('const ') || allText.includes('var ')
    if (!hasCodeDesc) {
      score -= 15
      issues.push('TTS does not describe code blocks')
    }
    if (hasRawCode) {
      score -= 20
      issues.push('TTS reads raw code syntax')
    }
  }

  // Check does not read raw markdown syntax
  if (expected.doesNotReadRawSyntax) {
    const rawSyntax = ['**', '##', '```', '[](', '- ']
    for (const s of rawSyntax) {
      if (allText.includes(s)) {
        score -= 10
        issues.push(`TTS reads raw syntax: "${s}"`)
      }
    }
  }

  // Check acronym pronunciation hints
  if (expected.pronouncesAcronyms) {
    for (const acronym of expected.pronouncesAcronyms as string[]) {
      if (!allText.includes(acronym.toLowerCase())) {
        score -= 5
        issues.push(`Missing acronym: ${acronym}`)
      }
    }
  }

  return {
    id: testCase.id as string,
    feature: 'tts-narration',
    passed: score >= 70,
    score: Math.max(0, score),
    details: issues.length > 0 ? issues.join('; ') : 'TTS narration handles all cases correctly',
    duration: Date.now() - start,
  }
}

// ─── Main Runner ───────────────────────────────────────────────────────────

async function runEvals() {
  console.log('🔍 md-reader Evaluation System')
  console.log('━'.repeat(60))

  const startAll = Date.now()

  for (const testCase of GROUND_TRUTH.testCases) {
    process.stdout.write(`  Testing: ${testCase.id}...`)

    let result: EvalResult

    try {
      switch (testCase.feature) {
        case 'toc-extraction':
          result = await evalTocExtraction(testCase)
          break
        case 'document-stats':
          result = await evalDocumentStats(testCase)
          break
        case 'collection-links':
          result = await evalCollectionLinks(testCase)
          break
        case 'ai-summarization':
          result = await evalSummarization(testCase)
          break
        case 'ai-qa':
          result = await evalQA(testCase)
          break
        case 'knowledge-graph':
          result = await evalKnowledgeGraph(testCase)
          break
        case 'coach-explanation':
          result = await evalCoach(testCase)
          break
        case 'cross-document-qa':
          result = await evalCrossDocQA(testCase)
          break
        case 'mindmap-visual':
          result = await evalMindMap(testCase)
          break
        case 'tts-narration':
          result = await evalTts(testCase)
          break
        default:
          result = { id: testCase.id, feature: testCase.feature, passed: true, score: -1, details: 'No evaluator implemented yet', duration: 0 }
      }
    } catch (e) {
      result = {
        id: testCase.id,
        feature: testCase.feature,
        passed: false,
        score: 0,
        details: `Error: ${e instanceof Error ? e.message : String(e)}`,
        duration: 0,
      }
    }

    results.push(result)
    const icon = result.score < 0 ? '⏭️' : result.passed ? '✅' : '❌'
    console.log(` ${icon} ${result.score >= 0 ? result.score + '/100' : 'SKIP'} (${result.duration}ms)`)
  }

  // ─── Report ────────────────────────────────────────────────────────────

  console.log('\n' + '━'.repeat(60))
  console.log('📊 EVALUATION REPORT')
  console.log('━'.repeat(60))

  const scoredResults = results.filter((r) => r.score >= 0)
  const passed = scoredResults.filter((r) => r.passed).length
  const failed = scoredResults.filter((r) => !r.passed).length
  const skipped = results.filter((r) => r.score < 0).length
  const avgScore = scoredResults.length > 0
    ? Math.round(scoredResults.reduce((s, r) => s + r.score, 0) / scoredResults.length)
    : 0

  console.log(`\n  Total:    ${results.length} tests`)
  console.log(`  Passed:   ${passed} ✅`)
  console.log(`  Failed:   ${failed} ❌`)
  console.log(`  Skipped:  ${skipped} ⏭️`)
  console.log(`  Avg Score: ${avgScore}/100`)
  console.log(`  Duration:  ${Date.now() - startAll}ms`)

  // Per-feature breakdown
  console.log('\n  Feature Breakdown:')
  const features = [...new Set(scoredResults.map((r) => r.feature))]
  for (const feature of features) {
    const featureResults = scoredResults.filter((r) => r.feature === feature)
    const featureAvg = Math.round(featureResults.reduce((s, r) => s + r.score, 0) / featureResults.length)
    const featurePassed = featureResults.every((r) => r.passed) ? '✅' : '⚠️'
    console.log(`    ${featurePassed} ${feature}: ${featureAvg}/100 (${featureResults.length} tests)`)
  }

  // Failures detail
  const failures = results.filter((r) => !r.passed && r.score >= 0)
  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) {
      console.log(`    ❌ ${f.id}: ${f.details}`)
    }
  }

  // Save results
  const reportPath = path.join(RESULTS_DIR, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results, summary: { total: results.length, passed, failed, skipped, avgScore } }, null, 2))
  console.log(`\n  📁 Full report saved to: ${reportPath}`)
  console.log('━'.repeat(60))
}

runEvals().catch(console.error)
