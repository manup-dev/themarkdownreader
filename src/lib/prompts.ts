/**
 * AI prompt templates — exported separately so both the app and the eval system can import them.
 * This file has NO browser/Vite dependencies (no import.meta.env).
 *
 * To optimize accuracy, modify these prompts and run:
 *   npx tsx scripts/eval/runner.ts
 */

export const PROMPTS = {
  summarize: 'Summarize this document as exactly 4 bullet points. Each bullet: under 20 words. Include main topic, key technologies, and named concepts. Only state facts from the text. Do NOT invent information.',
  summarizeSection: 'Summarize in 1-2 sentences. Under 30 words. Only state facts from the text.',
  askDocument: 'Answer ONLY from the provided context. Cite chunk numbers like [1], [2]. If not found, say "Not found in the document." Answer in under 100 words.',
  extractConcepts: 'Extract key concepts and relationships from this text. Return ONLY valid JSON: {"nodes":[{"id":"x","label":"Name","type":"concept|person|technology|process"}],"edges":[{"source":"x","target":"y","label":"rel"}]} Only JSON, 6-10 nodes. Every node and edge must come from the text.',
  coach: 'Explain the main point of this section in 1-2 simple sentences. Then give one real-world analogy (under 25 words). Then ask 1 question to check understanding. Total: under 90 words. Only use facts from the section.',
  quiz: 'Generate 2 quiz questions from the text. Return ONLY a JSON array, nothing else:\n[{"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"..."}]\nRules: exactly 4 options per question. "correct" is the index (0-3). All options must relate to the text.',
  eli5: 'Explain this to a 10-year-old in 2-3 simple sentences. Use everyday words. No jargon.',
  visualize: 'Describe this as if explaining a diagram. Use simple ASCII art or arrows if helpful. Max 100 words.',
} as const

export const PROMPT_CONFIG = {
  summarizeMaxInput: 1500,
  sectionMaxInput: 1000,
  qaMaxChunkLen: 500,
  conceptsMaxInput: 2000,
  coachMaxInput: 1000,
  quizMaxInput: 1200,
  temperature: 0.15,
  maxTokens: 350,
} as const
