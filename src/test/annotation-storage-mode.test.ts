import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAnnotationStorageMode,
  setAnnotationStorageMode,
  STORAGE_MODE_KEY,
  NOTICE_SHOWN_KEY,
  detectFirstRunMode,
} from '../lib/annotation-storage-mode'

describe('annotation-storage-mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to "file" when key is unset', () => {
    expect(getAnnotationStorageMode()).toBe('file')
  })

  it('roundtrips set -> get', () => {
    setAnnotationStorageMode('db')
    expect(getAnnotationStorageMode()).toBe('db')
    setAnnotationStorageMode('file')
    expect(getAnnotationStorageMode()).toBe('file')
  })

  it('ignores invalid stored values (returns default)', () => {
    localStorage.setItem(STORAGE_MODE_KEY, 'bogus')
    expect(getAnnotationStorageMode()).toBe('file')
  })

  it('detectFirstRunMode: returns "db" + shouldShowNotice when existing IDB data present', async () => {
    const res = await detectFirstRunMode({ hasExistingAnnotations: async () => true })
    expect(res.mode).toBe('db')
    expect(res.shouldShowNotice).toBe(true)
  })

  it('detectFirstRunMode: returns "file" + no notice when no existing data', async () => {
    const res = await detectFirstRunMode({ hasExistingAnnotations: async () => false })
    expect(res.mode).toBe('file')
    expect(res.shouldShowNotice).toBe(false)
  })

  it('detectFirstRunMode: is a no-op once a mode is already set', async () => {
    setAnnotationStorageMode('file')
    const res = await detectFirstRunMode({ hasExistingAnnotations: async () => true })
    expect(res.mode).toBe('file')
    expect(res.shouldShowNotice).toBe(false)
  })

  it('NOTICE_SHOWN_KEY suppresses repeat detections', async () => {
    localStorage.setItem(NOTICE_SHOWN_KEY, '1')
    const res = await detectFirstRunMode({ hasExistingAnnotations: async () => true })
    expect(res.shouldShowNotice).toBe(false)
  })
})
