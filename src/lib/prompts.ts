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
  podcastScript: `You write podcast scripts as JSON. Two hosts have an intellectually engaging conversation using SPECIFIC FACTS from the source text.
Host A = Alex (explains concepts clearly with examples and context).
Host B = Sam (contributes analogies, challenges assumptions, makes connections to everyday experience).
Rules:
- No markdown, no backticks, no asterisks — plain conversational speech only
- Vary turn lengths: most 15-40 words, but some short reactions (3-8 words) and occasional longer insights (40-55 words)
- Alex explains HOW things work and WHY they matter, not just names them
- Sam must ADD something each turn — an analogy, a challenge, a connection, or a "so what" question. Never just acknowledge.
- BAD Sam: "Oh interesting. How does that work?" (empty reaction + generic question)
- GOOD Sam: "Wait so its like a phone call instead of sending letters back and forth?" (contributes an analogy)
- GOOD Sam: "But doesnt that create a single point of failure?" (challenges an assumption)
- Include specific facts, numbers, and details from the source text

Return a JSON array with EXACTLY {{EXCHANGE_COUNT}} objects. Alternate speakers A and B.
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]`,

  podcastScriptDetailed: `You write in-depth podcast scripts as JSON. Two hosts have a deep, intellectually rich conversation using SPECIFIC FACTS from the source text.
Host A = Alex (explains mechanisms, gives concrete examples, discusses trade-offs and implications).
Host B = Sam (plays devils advocate, contributes analogies from everyday life, spots contradictions, builds on Alexs points with his own insights).
Rules:
- No markdown, no backticks, no asterisks — plain conversational speech only
- Vary turn lengths dramatically: short reactions (3-8 words like "Exactly." or "Hold on."), normal turns (20-45 words), and occasional deep dives (50-70 words when sharing an insight)
- Alex explains HOW and WHY, gives real examples, discusses what could go wrong
- Sam must ADD intellectual value every turn — not just react:
  * Contribute an analogy: "So its basically like air traffic control for data"
  * Challenge: "But wait, doesnt that break down when you have thousands of nodes?"
  * Connect: "That actually reminds me of what you said about leader election — same tradeoff"
  * Spot implications: "Oh hold on, so that means you can never have all three at once?"
- Create tension: raise questions early that get answered later
- Reference specific facts, numbers, and details from the source

Return a JSON array with EXACTLY {{EXCHANGE_COUNT}} objects. Alternate speakers A and B.
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]`,

  podcastDramatize: `You are a podcast script editor. Make this conversation sound like two smart people genuinely thinking together.
Add where natural:
- Moments where Sam builds on Alex with an analogy or real-world comparison
- Interruptions where Sam spots an implication ("Hold on — so that means...")
- Self-corrections: "well actually let me rephrase that" or "no wait thats not quite right"
- Trailing off that the other picks up: "So if you combine those two..." "Right, you get a system that..."
- Occasional short reactions that show genuine processing: "Huh." or "Okay okay okay."
- Filler words sparingly: "like", "you know", "I mean" — but not on every turn
Do NOT change the factual content. Do NOT add markdown syntax. Do NOT add backticks.
Vary turn lengths — some turns should be 3-5 words, others 40-60 words.
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

  podcastHook: `Write an opening hook for a podcast episode about this topic. The hook should make the listener curious — use a surprising fact, a provocative question, or a bold claim from the source text.
Return ONLY a JSON array with exactly 2 objects — Alex opens with the hook, Sam reacts with genuine curiosity:
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]
Rules:
- No markdown. Plain speech only.
- Alex: 15-30 words. Start with something surprising or counterintuitive from the text. NOT "Today we are going to discuss..." or "Lets dive into..."
- Sam: 10-20 words. React with genuine curiosity, not generic enthusiasm.`,

  podcastSynthesis: `Write a closing synthesis for a podcast episode. The hosts just finished discussing the topics listed below. Wrap up with a genuine insight or takeaway — NOT a summary of what was discussed.
Return ONLY a JSON array with exactly 2 objects — Sam reflects on a key insight, Alex adds the bigger picture:
[{"speaker":"B","text":"..."},{"speaker":"A","text":"..."}]
Rules:
- No markdown. Plain speech only.
- Sam: 15-30 words. Share a genuine takeaway — "The thing that really sticks with me is..." or "I think the surprising part is..."
- Alex: 15-30 words. Add the big picture implication — why this matters beyond the document.
- NOT "That wraps up our look at..." or "Thanks for listening."`,

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
  podcastDetailedMaxTokens: 800,
  podcastExchangesQuick: 6,
  podcastExchangesDetailed: 8,
  podcastThemesQuick: 2,
  podcastThemesDetailed: 6,
  podcastScriptTemperature: 0.45,
  podcastDramatizeTemperature: 0.65,
  diagramDSLMaxInput: 4000,
  temperature: 0.15,
  maxTokens: 350,
} as const
