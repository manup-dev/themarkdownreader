import type { Tab, TabPayload } from './tabs-types'

export type OpenDecision =
  | { action: 'focus'; tabId: string }
  | { action: 'fill'; tabId: string }
  | { action: 'new' }

function isEmpty(tab: Tab): boolean {
  return tab.kind === 'empty' && !tab.folderName && !tab.fileName
}

export function decideOpen(tabs: Tab[], activeTabId: string | null, payload: TabPayload): OpenDecision {
  // Same folder already open → focus it (regardless of which tab is active)
  if (payload.kind === 'folder') {
    const match = tabs.find((t) => t.kind === 'folder' && t.folderName === payload.folderName)
    if (match) return { action: 'focus', tabId: match.id }
  }
  const active = tabs.find((t) => t.id === activeTabId)
  if (active && isEmpty(active)) return { action: 'fill', tabId: active.id }
  return { action: 'new' }
}
