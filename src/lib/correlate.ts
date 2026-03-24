import { chat, type ChatMessage } from './ai'
import { getDocLinks, getAllDocuments, hierarchicalSearch, type StoredDocument } from './docstore'

/**
 * Cross-document correlation engine.
 * Builds context from multiple documents and explains connections via AI.
 */

export interface CorrelationResult {
  docA: string
  docB: string
  strength: number
  sharedTerms: string[]
  explanation?: string
}

export async function getCorrelations(): Promise<CorrelationResult[]> {
  const links = await getDocLinks()
  return links.map((l) => ({
    docA: l.source.fileName,
    docB: l.target.fileName,
    strength: l.strength,
    sharedTerms: l.sharedTerms,
  }))
}

export async function explainCorrelation(
  docA: StoredDocument,
  docB: StoredDocument,
  sharedTerms: string[],
  signal?: AbortSignal,
): Promise<string> {
  const contextA = docA.markdown.slice(0, 1500)
  const contextB = docB.markdown.slice(0, 1500)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a document analyst. Two documents share common themes. Explain the connection between them in 3-4 clear sentences. Focus on:
1. What topic/concept connects them
2. How they complement each other (different perspectives? sequential? contradictory?)
3. What insight emerges from reading both together that you'd miss reading just one

Be specific and insightful. Don't just list shared words.`,
    },
    {
      role: 'user',
      content: `Document A: "${docA.fileName}"\n${contextA}\n\n---\n\nDocument B: "${docB.fileName}"\n${contextB}\n\nShared themes: ${sharedTerms.join(', ')}`,
    },
  ]
  return chat(messages, signal)
}

export async function askAcrossDocuments(
  question: string,
  signal?: AbortSignal,
): Promise<{ answer: string; sources: Array<{ docFileName: string; sectionPath: string; text: string }> }> {
  const results = await hierarchicalSearch(question, 3, 8)

  if (results.length === 0) {
    return { answer: 'No relevant content found across your documents.', sources: [] }
  }

  const numberedContext = results
    .map((r, i) => `[${i + 1}] (${r.docFileName} > ${r.sectionPath})\n${r.text.slice(0, 500)}`)
    .join('\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You answer questions using content from MULTIPLE documents in the user's library.
Cite sources like [1], [2] etc. If documents disagree, note the differences.
Synthesize insights across documents when possible.
If the answer is not in any document, say so.`,
    },
    {
      role: 'user',
      content: `Context from multiple documents:\n---\n${numberedContext}\n---\n\nQuestion: ${question}`,
    },
  ]

  const answer = await chat(messages, signal)
  return {
    answer,
    sources: results.map((r) => ({
      docFileName: r.docFileName,
      sectionPath: r.sectionPath,
      text: r.text.slice(0, 200),
    })),
  }
}

export async function generateCollectionOverview(signal?: AbortSignal): Promise<string> {
  const docs = await getAllDocuments()
  if (docs.length === 0) return 'No documents in your library.'
  if (docs.length === 1) return 'Upload more documents to see cross-document analysis.'

  const summaries = docs
    .slice(0, 10) // limit to 10 docs
    .map((d) => `- "${d.fileName}" (${d.wordCount} words): ${d.markdown.slice(0, 200)}...`)
    .join('\n')

  const links = await getDocLinks()
  const topLinks = links.slice(0, 5).map(
    (l) => `"${l.source.fileName}" <-> "${l.target.fileName}" (similarity: ${(l.strength * 100).toFixed(0)}%, shared: ${l.sharedTerms.join(', ')})`,
  ).join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a librarian analyzing a collection of documents. Provide a brief, insightful overview:
1. What are the main themes across these documents?
2. How do the documents relate to each other?
3. What's the recommended reading order to build understanding?
4. What gaps exist — what topic isn't covered but probably should be?

Be concise (under 250 words) and actionable.`,
    },
    {
      role: 'user',
      content: `Documents:\n${summaries}\n\nKnown connections:\n${topLinks || 'None computed yet.'}`,
    },
  ]

  return chat(messages, signal)
}
