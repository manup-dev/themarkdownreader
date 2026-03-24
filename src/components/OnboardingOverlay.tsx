import { useState, useEffect, useRef } from 'react'

const STEPS = [
  {
    title: 'Welcome to md-reader!',
    text: 'This is your reading view. Scroll to read, use j/k keys to jump between sections.',
    target: 'article',
    position: 'center' as const,
  },
  {
    title: 'Try different views',
    text: 'Mind Map shows your document as a visual tree. Cards, Treemap, and Graph offer other ways to explore.',
    target: '[data-view-tabs]',
    position: 'below' as const,
  },
  {
    title: 'Chat with AI',
    text: 'Have questions? Click here to chat with AI about this document.',
    target: '[data-chat-fab]',
    position: 'above-left' as const,
  },
]

export function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = document.querySelector(STEPS[step].target)
    if (target) {
      const rect = target.getBoundingClientRect()
      setSpotlightRect(rect) // Intentional: update spotlight position when step changes
    } else {
      setSpotlightRect(null)
    }
  }, [step])

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      localStorage.setItem('md-reader-onboarding-done', 'true')
      onComplete()
    }
  }

  const handleSkip = () => {
    localStorage.setItem('md-reader-onboarding-done', 'true')
    onComplete()
  }

  const current = STEPS[step]
  const pad = 8

  // Card positioning
  const getCardStyle = (): React.CSSProperties => {
    if (!spotlightRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    }
    if (current.position === 'below') {
      return {
        top: spotlightRect.bottom + 16,
        left: Math.max(16, Math.min(spotlightRect.left, window.innerWidth - 340)),
      }
    }
    if (current.position === 'above-left') {
      return {
        bottom: window.innerHeight - spotlightRect.top + 16,
        right: window.innerWidth - spotlightRect.right,
      }
    }
    // center
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100]" style={{ pointerEvents: 'auto' }}>
      {/* Semi-transparent overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="onboarding-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlightRect && (
              <rect
                x={spotlightRect.left - pad}
                y={spotlightRect.top - pad}
                width={spotlightRect.width + pad * 2}
                height={spotlightRect.height + pad * 2}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(0,0,0,0.5)"
          mask="url(#onboarding-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {spotlightRect && (
        <div
          className="absolute border-2 border-blue-400 rounded-lg pointer-events-none"
          style={{
            left: spotlightRect.left - pad,
            top: spotlightRect.top - pad,
            width: spotlightRect.width + pad * 2,
            height: spotlightRect.height + pad * 2,
            boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.2)',
          }}
        />
      )}

      {/* Coach mark card */}
      <div
        className="absolute bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5 max-w-xs animate-scale-in"
        style={getCardStyle()}
      >
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{current.title}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{current.text}</p>
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{step + 1}/{STEPS.length}</span>
            <button
              onClick={handleNext}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {step < STEPS.length - 1 ? 'Next' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
