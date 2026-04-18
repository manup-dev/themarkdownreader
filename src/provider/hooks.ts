import { useContext } from 'react'
import { AdapterContext } from './AdapterContext'
import { useStore } from '../store/useStore'
import type { StorageAdapter } from '../types/storage-adapter'

export function useAdapter(): StorageAdapter {
  const adapter = useContext(AdapterContext)
  if (!adapter) throw new Error('useAdapter must be used within MdReaderProvider')
  return adapter
}

export function useDocument() {
  const markdown = useStore((s) => s.markdown)
  const fileName = useStore((s) => s.fileName)
  const toc = useStore((s) => s.toc)
  const activeDocId = useStore((s) => s.activeDocId)
  const openDocument = useStore((s) => s.openDocument)
  const setMarkdown = useStore((s) => s.setMarkdown)
  return { markdown, fileName, toc, activeDocId, openDocument, setMarkdown }
}

export function useTheme() {
  const theme = useStore((s) => s.theme)
  const fontSize = useStore((s) => s.fontSize)
  const dyslexicFont = useStore((s) => s.dyslexicFont)
  const setTheme = useStore((s) => s.setTheme)
  const setFontSize = useStore((s) => s.setFontSize)
  const setDyslexicFont = useStore((s) => s.setDyslexicFont)
  return { theme, fontSize, dyslexicFont, setTheme, setFontSize, setDyslexicFont }
}

export function useViewMode() {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  return { viewMode, setViewMode }
}

export function useChat() {
  const chatMessages = useStore((s) => s.chatMessages)
  const appendChatMessage = useStore((s) => s.appendChatMessage)
  const clearChatMessages = useStore((s) => s.clearChatMessages)
  const setChatMessages = useStore((s) => s.setChatMessages)
  return { messages: chatMessages, addMessage: appendChatMessage, clearMessages: clearChatMessages, setMessages: setChatMessages }
}

export function useFeatures() {
  const enabledFeatures = useStore((s) => s.enabledFeatures)
  const toggleFeature = useStore((s) => s.toggleFeature)
  return {
    enabledFeatures,
    isEnabled: (name: string) => enabledFeatures.has(name),
    toggleFeature,
  }
}
