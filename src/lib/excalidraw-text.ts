export interface ExcalidrawElement {
  id: string
  type: string
  text?: string
  x: number
  y: number
  isDeleted: boolean
  containerId?: string
  boundElements?: { id: string; type: string }[]
}

const ROW_THRESHOLD = 50

export function extractTextFromExcalidraw(elements: ExcalidrawElement[]): string {
  const textElements = elements
    .filter(el => el.type === 'text' && !el.isDeleted && el.text)
    .map(el => ({ text: el.text!, x: el.x, y: el.y }))

  if (textElements.length === 0) return ''

  textElements.sort((a, b) => {
    const rowDiff = Math.abs(a.y - b.y)
    if (rowDiff <= ROW_THRESHOLD) {
      return a.x - b.x
    }
    return a.y - b.y
  })

  return textElements.map(el => el.text.trim()).filter(Boolean).join('\n')
}
