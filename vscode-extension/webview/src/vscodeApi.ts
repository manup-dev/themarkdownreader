// acquireVsCodeApi() can only be called once — cache it
interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

let api: VsCodeApi | null = null

export function getVsCodeApi(): VsCodeApi | null {
  if (api) return api
  try {
    api = acquireVsCodeApi()
    return api
  } catch {
    // Not running in VS Code webview (e.g., standalone dev mode)
    return null
  }
}
