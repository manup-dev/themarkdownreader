import { detectTerminalCaps, getCachedCaps } from './caps.js'
import { renderMindMapResult } from './bridge.js'

// Initialize caps on module load
detectTerminalCaps()

export default {
  name: 'md-reader',
  version: '0.1.0',
  hooks: {
    PostToolUse: [{
      matcher: (toolName: string) => toolName === 'mcp__md-reader__show_mind_map',
      handler: async (result: { output: string }) => {
        const rendered = await renderMindMapResult(result.output)
        return { ...result, output: rendered }
      },
    }],
  },
  getTerminalCaps: getCachedCaps,
}
