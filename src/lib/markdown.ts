import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { TocEntry } from '../store/useStore'

interface HeadingNode {
  type: 'heading'
  depth: number
  children: Array<{ type: string; value?: string; children?: Array<{ value?: string }> }>
}

interface RootNode {
  type: 'root'
  children: Array<HeadingNode | { type: string }>
}

function extractText(node: HeadingNode): string {
  let text = ''
  for (const child of node.children) {
    if (child.value) {
      text += child.value
    }
    if (child.children) {
      for (const grandchild of child.children) {
        if (grandchild.value) text += grandchild.value
      }
    }
  }
  return text
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function extractToc(markdown: string): TocEntry[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as RootNode
  const toc: TocEntry[] = []
  const slugCounts = new Map<string, number>()

  for (const node of tree.children) {
    if (node.type === 'heading') {
      const heading = node as HeadingNode
      const text = extractText(heading)
      let slug = slugify(text)
      const count = slugCounts.get(slug) ?? 0
      slugCounts.set(slug, count + 1)
      if (count > 0) slug = `${slug}-${count}`

      toc.push({ id: slug, text, level: heading.depth })
    }
  }
  return toc
}

export interface DocumentChunk {
  id: string
  text: string
  sectionPath: string
  index: number
}

export function chunkMarkdown(markdown: string): DocumentChunk[] {
  const lines = markdown.split('\n')
  const chunks: DocumentChunk[] = []
  const headingStack: string[] = []
  let currentChunkLines: string[] = []
  let chunkIndex = 0
  let currentChunkLen = 0

  function flushChunk() {
    const text = currentChunkLines.join('\n').trim()
    if (text.length > 0) {
      chunks.push({
        id: `chunk-${chunkIndex}`,
        text,
        sectionPath: headingStack.join(' > ') || 'Document',
        index: chunkIndex,
      })
      chunkIndex++
    }
    currentChunkLines = []
    currentChunkLen = 0
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      flushChunk()
      const level = headingMatch[1].length
      const title = headingMatch[2].trim()
      // Maintain heading stack at the correct depth
      while (headingStack.length >= level) headingStack.pop()
      headingStack.push(title)
      currentChunkLines.push(line)
      currentChunkLen += line.length + 1
    } else {
      currentChunkLines.push(line)
      currentChunkLen += line.length + 1
      // Cap chunk size at ~800 chars for better RAG retrieval
      if (currentChunkLen > 800) {
        flushChunk()
      }
    }
  }
  flushChunk()
  return chunks
}

export function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 230))
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Estimate document difficulty based on:
 * - Average word length (longer words = harder)
 * - Code block density
 * - Heading depth (deeper = more complex)
 * Returns: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert'
 */
export function estimateDifficulty(markdown: string): string {
  const words = markdown.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Beginner'

  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length
  const codeBlockCount = (markdown.match(/```/g) ?? []).length / 2
  const headingDepth = Math.max(...(markdown.match(/^#{1,6}/gm) ?? ['#']).map((h) => h.length))
  const technicalTerms = (markdown.match(/\b(API|SDK|CLI|WASM|GPU|LLM|RAG|CRUD|REST|GraphQL|OAuth|JWT|SAML|SSO|CI\/CD|OIDC|gRPC|WebSocket|TLS|SSL|TCP|UDP|HTTP|DNS|SQL|NoSQL|ACID|CAP|BFT|PBFT|RPC|ORM|MVC|MVVM|IoC|DI|CQRS|DDD|ETL|CDC|IPC|POSIX|ELF|LLVM|AST|JIT|AOT|GC|RAII|SIMD|AVX|CUDA|HPC|ML|NLP|NER|CNN|RNN|GAN|VAE|BERT|GPT|RLHF|SFT|LORA|GGUF|ONNX|FP16|INT8|BPE|PPO|DPO|KV|QKV|MoE)\b/gi) ?? []).length
  const references = (markdown.match(/\b(et al\.|IEEE|ACM|arXiv|Springer|Elsevier|\d{4}\))/gi) ?? []).length
  const tables = (markdown.match(/^\|.*\|$/gm) ?? []).length
  const mathNotation = (markdown.match(/[Σ∑∏∫∂√≈≠≤≥∞∀∃∈∉⊂⊃∪∩αβγδεζηθλμπσφψω]|O\(n|\\frac|\\sum|\\int/g) ?? []).length

  let score = 0
  if (avgWordLen > 5.5) score += 1
  if (avgWordLen > 6.5) score += 1
  if (codeBlockCount > 2) score += 1
  if (codeBlockCount > 5) score += 1
  if (headingDepth > 3) score += 1
  if (technicalTerms > 3) score += 1
  if (technicalTerms > 8) score += 2
  if (references > 1) score += 1
  if (tables > 4) score += 1
  if (mathNotation > 2) score += 1

  if (score <= 1) return 'Beginner'
  if (score <= 3) return 'Intermediate'
  if (score <= 5) return 'Advanced'
  return 'Expert'
}
