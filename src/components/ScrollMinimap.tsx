import { useRef, useCallback, useState, useEffect } from 'react'
import type { TocEntry } from '../store/useStore'

interface ScrollMinimapProps {
  toc: TocEntry[]
  activeSection: string | null
  readingProgress: number
  contentRef: React.RefObject<HTMLDivElement | null>
}

export default function ScrollMinimap({ toc, activeSection, readingProgress, contentRef }: ScrollMinimapProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [viewportRatio, setViewportRatio] = useState(0.2)

  const sections = toc.filter((t) => t.level <= 2)

  // Update viewport ratio when content changes
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = () => {
      if (el.scrollHeight > 0) {
        setViewportRatio(Math.min(1, el.clientHeight / el.scrollHeight))
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [contentRef])

  const scrollToPosition = useCallback((clientY: number, smooth: boolean) => {
    const track = trackRef.current
    const el = contentRef.current
    if (!track || !el) return

    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const maxScroll = el.scrollHeight - el.clientHeight

    if (smooth) {
      el.scrollTo({ top: ratio * maxScroll, behavior: 'smooth' })
    } else {
      el.scrollTop = ratio * maxScroll
    }
  }, [contentRef])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    scrollToPosition(e.clientY, false)
  }, [scrollToPosition])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    scrollToPosition(e.clientY, false)
  }, [isDragging, scrollToPosition])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    // Only smooth-scroll on direct click (not end of drag)
    if (!isDragging) {
      scrollToPosition(e.clientY, true)
    }
  }, [isDragging, scrollToPosition])

  // Viewport rectangle position and size
  const progressFraction = readingProgress / 100
  const viewportHeight = Math.max(8, viewportRatio * 100) // percentage of track, min 8%
  const viewportTop = progressFraction * (100 - viewportHeight) // percentage

  const expanded = isHovered || isDragging

  return (
    <div
      className="fixed top-16 right-0 bottom-16 z-10 transition-all duration-200 ease-out"
      style={{ width: expanded ? 28 : 20 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Track background */}
      <div
        ref={trackRef}
        className="absolute inset-0 cursor-pointer"
        onClick={handleTrackClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track rail */}
        <div className={`absolute inset-y-0 right-0 transition-all duration-200 ${
          expanded
            ? 'w-full bg-gray-200/60 dark:bg-gray-700/40'
            : 'w-full bg-gray-200/30 dark:bg-gray-700/20'
        } rounded-l`} />

        {/* Section markers */}
        {sections.map((entry, i) => {
          const pct = sections.length > 1 ? (i / (sections.length - 1)) * 100 : 50
          const isActive = activeSection === entry.id
          const isH1 = entry.level === 1

          return (
            <div
              key={entry.id}
              className={`absolute right-0 rounded-l transition-all duration-150 ${
                isActive
                  ? 'bg-blue-500 dark:bg-blue-400'
                  : 'bg-gray-400/70 dark:bg-gray-500/60'
              }`}
              style={{
                top: `${pct}%`,
                height: isH1 ? 4 : 2,
                width: expanded ? (isH1 ? '80%' : '60%') : (isH1 ? '70%' : '50%'),
                transform: 'translateY(-50%)',
              }}
              title={entry.text}
            />
          )
        })}

        {/* Viewport rectangle */}
        <div
          className={`absolute right-0 rounded-l transition-colors duration-150 pointer-events-none ${
            isDragging
              ? 'bg-blue-500/35 dark:bg-blue-400/35 border-l-2 border-blue-500 dark:border-blue-400'
              : expanded
                ? 'bg-blue-500/25 dark:bg-blue-400/25 border-l-2 border-blue-500/70 dark:border-blue-400/70'
                : 'bg-blue-500/15 dark:bg-blue-400/15 border-l-2 border-blue-500/40 dark:border-blue-400/40'
          }`}
          style={{
            top: `${viewportTop}%`,
            height: `${viewportHeight}%`,
            width: '100%',
          }}
        />
      </div>
    </div>
  )
}
