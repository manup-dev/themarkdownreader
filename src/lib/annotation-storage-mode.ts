export type AnnotationStorageMode = 'file' | 'db'

export const STORAGE_MODE_KEY = 'md-reader-annotation-storage-mode'
export const NOTICE_SHOWN_KEY = 'md-reader-storage-notice-shown'

export function getAnnotationStorageMode(): AnnotationStorageMode {
  try {
    const raw = localStorage.getItem(STORAGE_MODE_KEY)
    if (raw === 'file' || raw === 'db') return raw
    return 'file'
  } catch {
    return 'file'
  }
}

export function setAnnotationStorageMode(mode: AnnotationStorageMode): void {
  try { localStorage.setItem(STORAGE_MODE_KEY, mode) } catch { /* quota */ }
}

export function markNoticeShown(): void {
  try { localStorage.setItem(NOTICE_SHOWN_KEY, '1') } catch { /* quota */ }
}

export interface FirstRunInput {
  hasExistingAnnotations: () => Promise<boolean>
}

export interface FirstRunResult {
  mode: AnnotationStorageMode
  shouldShowNotice: boolean
}

/**
 * Chooses the initial mode for a user who has never set it. When the legacy
 * tables already carry highlights or comments we keep them on 'db' and
 * surface a one-time notice so they can opt into file mode consciously.
 * New installs default to 'file'.
 */
export async function detectFirstRunMode(input: FirstRunInput): Promise<FirstRunResult> {
  try {
    const existingMode = localStorage.getItem(STORAGE_MODE_KEY)
    if (existingMode === 'file' || existingMode === 'db') {
      return { mode: existingMode, shouldShowNotice: false }
    }
  } catch { /* ignored — treat as fresh */ }

  const noticeAlreadyShown = (() => {
    try { return localStorage.getItem(NOTICE_SHOWN_KEY) === '1' } catch { return false }
  })()

  const hasData = await input.hasExistingAnnotations()
  if (hasData) {
    setAnnotationStorageMode('db')
    return { mode: 'db', shouldShowNotice: !noticeAlreadyShown }
  }
  setAnnotationStorageMode('file')
  return { mode: 'file', shouldShowNotice: false }
}
