import { useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import { useStore } from '../store/useStore'

interface ExcalidrawViewerProps {
  content: string
  fileName: string
}

export function ExcalidrawViewer({ content, fileName }: ExcalidrawViewerProps) {
  const theme = useStore((s) => s.theme)

  const sceneData = useMemo(() => {
    try {
      return JSON.parse(content)
    } catch {
      return null
    }
  }, [content])

  if (!sceneData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <p>Failed to parse Excalidraw file: {fileName}</p>
      </div>
    )
  }

  const excalidrawTheme = theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light'

  return (
    <div className="w-full h-full min-h-[600px]">
      <Excalidraw
        initialData={{
          elements: sceneData.elements ?? [],
          appState: {
            ...sceneData.appState,
            viewModeEnabled: true,
            zenModeEnabled: true,
            gridModeEnabled: false,
            theme: excalidrawTheme,
          },
          files: sceneData.files ?? undefined,
        }}
        viewModeEnabled={true}
        zenModeEnabled={true}
        gridModeEnabled={false}
        theme={excalidrawTheme}
      />
    </div>
  )
}
