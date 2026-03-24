import { describe, it, expect } from 'vitest'
import { PROMPTS, PROMPT_CONFIG } from '../lib/prompts'

describe('PROMPTS', () => {
  it('has all required prompt templates', () => {
    expect(PROMPTS.summarize).toBeDefined()
    expect(PROMPTS.summarizeSection).toBeDefined()
    expect(PROMPTS.askDocument).toBeDefined()
    expect(PROMPTS.extractConcepts).toBeDefined()
    expect(PROMPTS.coach).toBeDefined()
    expect(PROMPTS.quiz).toBeDefined()
    expect(PROMPTS.eli5).toBeDefined()
    expect(PROMPTS.visualize).toBeDefined()
  })

  it('summarize prompt includes word limit constraint', () => {
    expect(PROMPTS.summarize.toLowerCase()).toMatch(/bullet|point/)
    expect(PROMPTS.summarize.toLowerCase()).toContain('word')
  })

  it('askDocument prompt enforces citation format', () => {
    expect(PROMPTS.askDocument).toContain('[1]')
    expect(PROMPTS.askDocument).toContain('[2]')
  })

  it('quiz prompt asks for JSON format', () => {
    expect(PROMPTS.quiz.toLowerCase()).toContain('json')
  })

  it('eli5 prompt targets simple language', () => {
    expect(PROMPTS.eli5.toLowerCase()).toMatch(/simple|10-year-old|elementary/)
  })

  it('coach prompt includes analogy requirement', () => {
    expect(PROMPTS.coach.toLowerCase()).toContain('analogy')
  })
})

describe('PROMPT_CONFIG', () => {
  it('has reasonable temperature', () => {
    expect(PROMPT_CONFIG.temperature).toBeGreaterThan(0)
    expect(PROMPT_CONFIG.temperature).toBeLessThanOrEqual(1)
  })

  it('has reasonable max tokens', () => {
    expect(PROMPT_CONFIG.maxTokens).toBeGreaterThanOrEqual(200)
    expect(PROMPT_CONFIG.maxTokens).toBeLessThanOrEqual(1000)
  })

  it('has reasonable input limits', () => {
    expect(PROMPT_CONFIG.summarizeMaxInput).toBeGreaterThan(500)
    expect(PROMPT_CONFIG.qaMaxChunkLen).toBeGreaterThan(200)
    expect(PROMPT_CONFIG.conceptsMaxInput).toBeGreaterThan(1000)
  })

  it('has quiz input larger than coach', () => {
    expect(PROMPT_CONFIG.quizMaxInput).toBeGreaterThanOrEqual(PROMPT_CONFIG.coachMaxInput)
  })
})
