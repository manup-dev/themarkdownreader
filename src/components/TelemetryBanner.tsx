import { useState } from 'react'
import { BarChart3, X, ChevronDown, ChevronUp } from 'lucide-react'
import { hasBeenAsked, enableTelemetry, disableTelemetry, TRACKED_EVENTS } from '../lib/telemetry'

export function TelemetryBanner() {
  const [dismissed, setDismissed] = useState(() => hasBeenAsked())
  const [showDetails, setShowDetails] = useState(false)

  if (dismissed) return null

  const handleEnable = () => {
    enableTelemetry()
    setDismissed(true)
  }

  const handleDecline = () => {
    disableTelemetry()
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg shrink-0">
            <BarChart3 className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Help improve md-reader</h3>
              <button onClick={handleDecline} className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              Share anonymous usage stats — like which features you use, not what you read. No personal data, ever. Helps us know what to build next.
            </p>

            {/* Expandable details */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 mt-2"
            >
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showDetails ? 'Hide details' : 'See exactly what\'s tracked'}
            </button>

            {showDetails && (
              <div className="mt-2 max-h-40 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="pb-1 font-medium">Event</th>
                      <th className="pb-1 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 dark:text-gray-400">
                    {TRACKED_EVENTS.map((e) => (
                      <tr key={e.event}>
                        <td className="py-0.5 pr-2 font-mono text-gray-500 dark:text-gray-500">{e.event}</td>
                        <td className="py-0.5">{e.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-2 border-t border-gray-100 dark:border-gray-800 pt-2">
                  Never tracked: file contents, filenames, usernames, emails, API keys, IP addresses, or any personal data.
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleEnable}
                className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Enable analytics
              </button>
              <button
                onClick={handleDecline}
                className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                No thanks
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center">
              You can change this anytime in Settings
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
