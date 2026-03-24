import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  name?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const hints: Record<string, string> = {
        Chat: 'Check AI settings — make sure Ollama is running or an API key is configured.',
        'Mind Map': 'Try a simpler document or reload the page.',
        'Knowledge Graph': 'The AI model may have returned invalid data. Click retry or try a different document.',
        Coach: 'Check AI settings — the coach needs Ollama or WebLLM to generate explanations.',
        Treemap: 'The document structure may not be compatible. Try a document with clear headings.',
        Workspace: 'Try clearing browser cache or exporting your library first.',
      }
      const hint = this.props.name ? hints[this.props.name] : null

      return this.props.fallback ?? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-3 max-w-md">
            <div className="text-3xl">:/</div>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              {this.props.name ? `${this.props.name} failed` : 'Something went wrong'}
            </h3>
            <p className="text-sm text-gray-400">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            {hint && (
              <p className="text-xs text-gray-400/70">{hint}</p>
            )}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="text-sm px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
