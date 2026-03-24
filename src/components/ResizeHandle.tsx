import { useCallback, useRef, useState } from 'react'

interface Props {
  onResize: (delta: number) => void
}

export function ResizeHandle({ onResize }: Props) {
  const startX = useRef(0)
  const [dragging, setDragging] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startX.current = e.clientX
    setDragging(true)

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current
      startX.current = ev.clientX
      if (delta !== 0) onResize(delta)
    }

    const handleMouseUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [onResize])

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`w-1.5 shrink-0 cursor-col-resize transition-colors flex items-center justify-center relative ${
        dragging ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-800 hover:bg-blue-400'
      }`}
      style={{ touchAction: 'none' }}
    >
      <div className="flex flex-col gap-0.5">
        <div className={`w-0.5 h-0.5 rounded-full ${dragging ? 'bg-white' : 'bg-gray-400'}`} />
        <div className={`w-0.5 h-0.5 rounded-full ${dragging ? 'bg-white' : 'bg-gray-400'}`} />
        <div className={`w-0.5 h-0.5 rounded-full ${dragging ? 'bg-white' : 'bg-gray-400'}`} />
      </div>
      {dragging && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap z-50">
          drag
        </div>
      )}
    </div>
  )
}
