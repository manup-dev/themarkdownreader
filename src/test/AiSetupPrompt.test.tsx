import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiSetupPrompt, OPEN_AI_SETTINGS_EVENT } from '../components/AiSetupPrompt'

describe('AiSetupPrompt', () => {
  it('names the feature and offers the three backend options', () => {
    render(<AiSetupPrompt feature="Chat" />)
    expect(screen.getByText(/Chat needs an AI backend/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /free cloud AI/i })).toBeTruthy()
    expect(screen.getByText(/Ollama/i)).toBeTruthy()
    expect(screen.getByText(/WebGPU/i)).toBeTruthy()
  })

  it('fires the open-settings event on CTA click', () => {
    const listener = vi.fn()
    window.addEventListener(OPEN_AI_SETTINGS_EVENT, listener)
    render(<AiSetupPrompt feature="Chat" />)
    fireEvent.click(screen.getByRole('button', { name: /free cloud AI/i }))
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(OPEN_AI_SETTINGS_EVENT, listener)
  })
})
