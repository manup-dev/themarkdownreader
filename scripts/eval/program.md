# md-reader autoresearch

Adapted from [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

This is an experiment to have the LLM autonomously improve md-reader's AI accuracy.

## Setup

1. **Read the in-scope files**:
   - `scripts/eval/ground-truth.json` — expected outputs. Do not modify.
   - `scripts/eval/runner.ts` — the eval harness. Do not modify.
   - `scripts/eval/test-corpus/*.md` — test documents. Do not modify.
   - `src/lib/ai.ts` — **the file you modify**. All AI prompts live here.

2. **Establish baseline**: Run `npx tsx scripts/eval/runner.ts` and record the baseline scores.

3. **Initialize results.tsv**: Create `scripts/eval/results.tsv` with the header row.

## Experimentation

Each experiment modifies the AI prompts in `src/lib/ai.ts` and reruns the eval. The eval takes ~30-60 seconds (with warm Ollama model).

**What you CAN do:**
- Modify the system prompts in `src/lib/ai.ts` — all high-level AI functions: `summarize()`, `summarizeSection()`, `askAboutDocument()`, `extractConceptsAndRelations()`, `generateCoachExplanation()`, `generateQuiz()`
- Change prompt structure, system instructions, temperature, max_tokens
- Add few-shot examples to prompts
- Change chunking strategy (how much context is sent)
- Change the input truncation limits (`.slice(0, N)`)

**What you CANNOT do:**
- Modify the eval runner (`scripts/eval/runner.ts`)
- Modify the ground truth (`scripts/eval/ground-truth.json`)
- Modify the test corpus files
- Change the AI backend (model, endpoint, API)
- Install new dependencies

**The goal is simple: get the highest average eval score across all features.**

The single metric is: **avg_score** (average of all non-skipped test scores, 0-100).

**Simplicity criterion**: All else being equal, simpler prompts are better. A 2-point improvement from adding 200 words to a prompt is not worth it. A 2-point improvement from making a prompt shorter? Definitely keep.

## Output format

The eval runner prints a report:

```
📊 EVALUATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total:    15 tests
  Passed:   6 ✅
  Failed:   1 ❌
  Skipped:  8 ⏭️
  Avg Score: 68/100
```

## Logging results

Log to `scripts/eval/results.tsv` (tab-separated):

```
commit	avg_score	toc_score	stats_score	summary_score	links_score	status	description
```

Example:
```
commit	avg_score	toc_score	stats_score	summary_score	links_score	status	description
a1b2c3d	68	80	88	33	75	keep	baseline
b2c3d4e	72	80	88	55	75	keep	improved summary prompt with explicit bullet format
c3d4e5f	65	80	88	20	75	discard	over-constrained summary prompt caused hallucination
```

## The experiment loop

LOOP FOREVER:

1. Look at current prompt state in `src/lib/ai.ts`
2. Form a hypothesis: "If I change the summary prompt to X, it should improve faithfulness"
3. Edit the prompt in `src/lib/ai.ts`
4. Run the eval: `npx tsx scripts/eval/runner.ts 2>&1 | tee scripts/eval/run.log`
5. Extract scores: `grep "Avg Score:" scripts/eval/run.log`
6. Record in results.tsv
7. If avg_score improved → keep the change
8. If avg_score equal or worse → revert with `git checkout src/lib/ai.ts`
9. GOTO 1

**Strategies to try:**
- Add explicit output format instructions ("respond in bullet points")
- Add faithfulness constraints ("only mention facts from the provided text")
- Add few-shot examples (1-2 examples of ideal summaries)
- Reduce context size (less input = less noise for small models)
- Change temperature (lower = more deterministic = more faithful)
- Change max_tokens (shorter outputs = less chance of hallucination)
- Use chain-of-thought ("first identify key points, then summarize")
- Add negative instructions ("do NOT include information not in the source")

**NEVER STOP**: Continue running experiments until manually interrupted. If stuck, try combining successful strategies, or try radical changes to prompt structure.
