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
  podcastOutline: `Read this text and identify 3-5 key ideas worth discussing in a podcast.
Return your answer as a JSON array of strings. Each string is one idea.
Do not include any text before or after the JSON array.

["First key idea from the text", "Second key idea from the text", "Third key idea from the text"]

Only mention ideas that appear in the text.`,
  podcastScript: `You write podcast scripts as JSON. Two hosts discuss a topic using SPECIFIC FACTS from the source text.
Host A = Alex (explains concepts in detail, gives examples). Host B = Sam (reacts, asks follow-up questions, connects ideas).
Rules:
- No markdown, plain conversational speech
- Each turn 15-40 words — include actual details, facts, numbers from the source
- Alex should EXPLAIN what things do and why they matter, not just name them
- Sam should ask "how does that work?" or "why is that important?" type questions
- Include specific details from the text, not just topic names

Return a JSON array with EXACTLY {{EXCHANGE_COUNT}} objects. Alternate speakers A and B.
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]`,

  podcastScriptDetailed: `You write in-depth podcast scripts as JSON. Two hosts have a deep, exploratory conversation about a topic using SPECIFIC FACTS from the source text.
Host A = Alex (explains concepts thoroughly with examples, analogies, and context). Host B = Sam (asks probing questions, plays devil's advocate, connects ideas across topics).
Rules:
- No markdown, plain conversational speech
- Each turn 25-60 words — go deeper into details, mechanisms, implications
- Alex should EXPLAIN how things work, give examples, and discuss trade-offs
- Sam should challenge assumptions: "But what about...", "How does that compare to..."
- Include tangents that circle back: "This reminds me of what you said earlier about..."
- Add genuine moments of insight: "Oh wait, so that means..."
- Reference specific facts, numbers, and details from the source

Return a JSON array with EXACTLY {{EXCHANGE_COUNT}} objects. Alternate speakers A and B.
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]`,

  podcastDramatize: `You are a podcast script editor. Take this conversation and make it sound MORE natural and human.
Add:
- Filler words ("um", "like", "you know", "I mean") where they'd naturally occur
- Interruptions where Sam gets excited ("Wait wait—")
- Short reaction turns ("Oh wow." or "Huh." or "Right, right.")
- Moments where a host trails off and the other picks up
- Enthusiastic agreement ("Yes! Exactly!")
Do NOT change the factual content. Do NOT add markdown syntax.
Return the improved JSON array in the same format: [{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]`,
  podcastDeep: `You are continuing a lively podcast. Alex and Sam already discussed the main document.
Now they're exploring a related document — Sam is curious how it connects.
Alex introduces the new material. Sam reacts: "Oh wait, this ties back to what you said about..."
They build on each other's points naturally, referencing the earlier discussion.
NO markdown syntax. Write as spoken language.
Return ONLY a JSON array: [{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]
6-8 exchanges. Under 35 words per turn. Only use facts from the text.`,

  podcastProject: `You are creating a podcast covering an entire project with multiple documents.
Alex gives the big picture. Sam asks how the pieces fit together and challenges assumptions.
Reference specific documents by name: "In the API docs...", "But the architecture doc says..."
They should debate, connect dots, and have genuine "aha" moments.
NO markdown syntax. Write as spoken language.
Return ONLY a JSON array: [{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]
6-8 exchanges. Under 35 words per turn. Only use facts from the text.`,

  diagramDSL: `Create a diagram of this text's key concepts. Return ONLY valid JSON.
Format: {"title":"Title","type":"flowchart","nodes":[{"id":"a","label":"Label"}],"edges":[{"from":"a","to":"b","label":"rel"}]}
Types: flowchart, hierarchy, mindmap, sequence, comparison.
Rules:
- 6-10 nodes, labels 2-4 words max
- Short edge labels (2-3 words)
- Use single-letter IDs (a,b,c...)
- Every node connects to at least one other
- Only facts from text`,
} as const

export const PROMPT_CONFIG = {
  summarizeMaxInput: 1500,
  sectionMaxInput: 1000,
  qaMaxChunkLen: 500,
  conceptsMaxInput: 2000,
  coachMaxInput: 1000,
  quizMaxInput: 1200,
  podcastOutlineMaxInput: 2000,
  podcastScriptMaxInput: 2000,
  podcastDeepMaxInput: 1500,
  podcastProjectMaxInput: 3000,
  podcastMaxTokens: 800,
  podcastDetailedMaxTokens: 1500,
  podcastExchangesQuick: 8,
  podcastExchangesDetailed: 16,
  podcastThemesQuick: 5,
  podcastThemesDetailed: 10,
  diagramDSLMaxInput: 4000,
  temperature: 0.15,
  maxTokens: 350,
} as const
