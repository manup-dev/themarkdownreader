import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlanView } from '../components/PlanView'
import { useStore } from '../store/useStore'

const MD = `## Security
- [ ] Add rate-limiting
## Tests
- [ ] Write tests
`

describe('PlanView', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ markdown: MD, fileName: 'plan.md', activeDocId: null })
  })

  it('lists extracted checkbox tasks grouped by section', () => {
    render(<PlanView />)
    expect(screen.getByText('Add rate-limiting')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText(/2 open · 0 done · 0 blocked/)).toBeInTheDocument()
  })

  it('dispatch copies a grounded prompt to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PlanView />)
    fireEvent.click(screen.getAllByText('Dispatch')[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('Add rate-limiting')
    expect(writeText.mock.calls[0][0]).toContain('`plan.md`')
  })
})
