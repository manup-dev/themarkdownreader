/**
 * Unit tests for gemma-engine.ts
 *
 * @huggingface/transformers is mocked so no real model is loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @huggingface/transformers ──────────────────────────────────────────

const mockDecode = vi.fn((ids: number[]) => ids.map(() => 'word').join(' '))
const mockApplyChatTemplate = vi.fn(() => 'formatted prompt')
const mockTokenizer = vi.fn(() => ({
  input_ids: { dims: [1, 5], data: new Int32Array([1, 2, 3, 4, 5]) },
}))
Object.assign(mockTokenizer, { apply_chat_template: mockApplyChatTemplate, decode: mockDecode })

const mockGenerate = vi.fn().mockResolvedValue([
  { data: new BigInt64Array([1n, 2n, 3n, 4n, 5n, 6n, 7n]) },
])

const mockAutoTokenizer = { from_pretrained: vi.fn().mockResolvedValue(mockTokenizer) }
const mockAutoModel = { from_pretrained: vi.fn().mockResolvedValue({ generate: mockGenerate }) }

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: mockAutoTokenizer,
  AutoModelForCausalLM: mockAutoModel,
  Tensor: class {},
  env: { allowLocalModels: false, useBrowserCache: false },
}))

// ─── Import after mock ────────────────────────────────────────────────────────

import {
  loadGemmaModel,
  gemmaChat,
  getGemmaStatus,
  unloadGemma,
  onGemmaProgress,
} from '../lib/inference/gemma-engine'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset internal module state between tests via unloadGemma */
beforeEach(async () => {
  await unloadGemma()
  vi.clearAllMocks()
  // Auto-confirm download dialogs in tests
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  // Re-wire mocks after clearAllMocks
  mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer)
  mockAutoModel.from_pretrained.mockResolvedValue({ generate: mockGenerate })
  mockGenerate.mockResolvedValue([
    { data: new BigInt64Array([1n, 2n, 3n, 4n, 5n, 6n, 7n]) },
  ])
  mockDecode.mockReturnValue('hello world')
  mockApplyChatTemplate.mockReturnValue('formatted prompt')
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('gemma-engine exports', () => {
  it('exports loadGemmaModel as a function', () => {
    expect(typeof loadGemmaModel).toBe('function')
  })

  it('exports gemmaChat as a function', () => {
    expect(typeof gemmaChat).toBe('function')
  })

  it('exports getGemmaStatus as a function', () => {
    expect(typeof getGemmaStatus).toBe('function')
  })

  it('exports unloadGemma as a function', () => {
    expect(typeof unloadGemma).toBe('function')
  })

  it('exports onGemmaProgress as a function', () => {
    expect(typeof onGemmaProgress).toBe('function')
  })
})

describe('getGemmaStatus', () => {
  it('returns idle before any load', () => {
    expect(getGemmaStatus()).toBe('idle')
  })
})

describe('unloadGemma', () => {
  it('resets status to idle after loading', async () => {
    await loadGemmaModel()
    expect(getGemmaStatus()).toBe('ready')

    await unloadGemma()
    expect(getGemmaStatus()).toBe('idle')
  })

  it('is safe to call when already idle', async () => {
    await expect(unloadGemma()).resolves.not.toThrow()
    expect(getGemmaStatus()).toBe('idle')
  })
})

describe('loadGemmaModel', () => {
  it('transitions to ready after successful load', async () => {
    await loadGemmaModel()
    expect(getGemmaStatus()).toBe('ready')
  })

  it('calls AutoTokenizer.from_pretrained with HF model id', async () => {
    await loadGemmaModel()
    expect(mockAutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      'onnx-community/Qwen3-0.6B-ONNX',
    )
  })

  it('calls AutoModelForCausalLM.from_pretrained', async () => {
    await loadGemmaModel()
    expect(mockAutoModel.from_pretrained).toHaveBeenCalled()
  })

  it('is idempotent — second call does not re-load', async () => {
    await loadGemmaModel()
    await loadGemmaModel()
    expect(mockAutoTokenizer.from_pretrained).toHaveBeenCalledTimes(1)
  })

})

describe('onGemmaProgress', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onGemmaProgress(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('receives loading and ready events during loadGemmaModel', async () => {
    const events: string[] = []
    const unsub = onGemmaProgress((p) => events.push(p.status))
    await loadGemmaModel()
    unsub()
    expect(events).toContain('loading')
    expect(events).toContain('ready')
  })
})

describe('gemmaChat', () => {
  it('loads model automatically if not loaded', async () => {
    expect(getGemmaStatus()).toBe('idle')
    await gemmaChat([{ role: 'user', content: 'hello' }])
    expect(getGemmaStatus()).toBe('ready')
  })

  it('returns a string reply', async () => {
    const reply = await gemmaChat([{ role: 'user', content: 'hello' }])
    expect(typeof reply).toBe('string')
  })

  it('applies the chat template before tokenising', async () => {
    await gemmaChat([{ role: 'user', content: 'ping' }])
    expect(mockApplyChatTemplate).toHaveBeenCalledWith(
      [{ role: 'user', content: 'ping' }],
      expect.objectContaining({ add_generation_prompt: true }),
    )
  })

  it('calls model.generate', async () => {
    await gemmaChat([{ role: 'user', content: 'test' }])
    expect(mockGenerate).toHaveBeenCalled()
  })

  it('throws AbortError when signal is already aborted', async () => {
    await loadGemmaModel()
    const controller = new AbortController()
    controller.abort()
    await expect(
      gemmaChat([{ role: 'user', content: 'hi' }], undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
