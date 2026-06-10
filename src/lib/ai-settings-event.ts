// Cross-component signal to open the AI Settings modal, which lives as local
// state in Toolbar.tsx. Same pattern as 'md-reader-highlight-changed'.
// Kept out of the AiSetupPrompt component file so that file stays a
// component-only module (Vite fast-refresh requirement).
export const OPEN_AI_SETTINGS_EVENT = 'md-reader-open-ai-settings'

export function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_AI_SETTINGS_EVENT))
}
