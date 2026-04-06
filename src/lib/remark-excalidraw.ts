export interface ExcalidrawRef {
  type: 'image' | 'link' | 'codeblock'
  path?: string
  content?: string
}

const EXCALIDRAW_EXT = /\.excalidraw(?:\.json)?$/

export function detectExcalidrawRefs(markdown: string): ExcalidrawRef[] {
  const refs: ExcalidrawRef[] = []

  // Image syntax: ![alt](path.excalidraw)
  const imageRegex = /!\[[^\]]*\]\(([^)]*\.excalidraw(?:\.json)?)\)/g
  let match: RegExpExecArray | null
  while ((match = imageRegex.exec(markdown)) !== null) {
    refs.push({ type: 'image', path: match[1] })
  }

  // Link syntax: [text](path.excalidraw) — but NOT image syntax
  const linkRegex = /(?<!!)\[[^\]]*\]\(([^)]*\.excalidraw(?:\.json)?)\)/g
  while ((match = linkRegex.exec(markdown)) !== null) {
    refs.push({ type: 'link', path: match[1] })
  }

  // Code fence: ```excalidraw ... ```
  const codeRegex = /```excalidraw\s*\n([\s\S]*?)```/g
  while ((match = codeRegex.exec(markdown)) !== null) {
    refs.push({ type: 'codeblock', content: match[1].trim() })
  }

  return refs
}

export function isExcalidrawFile(fileName: string): boolean {
  return EXCALIDRAW_EXT.test(fileName)
}
