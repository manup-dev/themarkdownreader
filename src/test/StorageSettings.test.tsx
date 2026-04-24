import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StorageSettings } from '../components/StorageSettings'
import { getAnnotationStorageMode, setAnnotationStorageMode } from '../lib/annotation-storage-mode'

describe('StorageSettings', () => {
  beforeEach(() => { localStorage.clear() })

  it('renders both options and reflects current mode', () => {
    setAnnotationStorageMode('file')
    render(<StorageSettings />)
    const fileRadio = screen.getByLabelText(/Sidecar file/i) as HTMLInputElement
    const dbRadio = screen.getByLabelText(/Local database/i) as HTMLInputElement
    expect(fileRadio.checked).toBe(true)
    expect(dbRadio.checked).toBe(false)
  })

  it('changing radio persists the new mode', () => {
    setAnnotationStorageMode('file')
    render(<StorageSettings />)
    fireEvent.click(screen.getByLabelText(/Local database/i))
    expect(getAnnotationStorageMode()).toBe('db')
  })

  it('shows the folder-only caveat line', () => {
    render(<StorageSettings />)
    expect(screen.getByText(/opened from a folder/i)).toBeInTheDocument()
  })
})
