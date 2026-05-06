// Renderer-side proxy to the Electron preload bridge (window.deeptutor).
//
// Returns null in regular browser builds so callers can fall back to
// non-Electron behaviour with `if (bridge) { ... }`.

export interface ElectronBridge {
  isElectron: true
  getSettings: () => Promise<{
    settings: Record<string, unknown>
    secretStatus: Record<string, boolean>
    secretKeys: readonly string[]
  }>
  saveSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
  setSecret: (key: string, value: string) => Promise<{ ok: true }>
  hasSecret: (key: string) => Promise<boolean>
  restartSidecar: () => Promise<{ ok: boolean; hint?: string }>
  uploadDroppedPaths: (
    paths: string[]
  ) => Promise<{ path: string; ok: boolean; response?: unknown; error?: string }[]>
}

declare global {
  interface Window {
    deeptutor?: ElectronBridge
  }
}

export function getElectronBridge(): ElectronBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.deeptutor
  return bridge && bridge.isElectron === true ? bridge : null
}

export function isElectron(): boolean {
  return getElectronBridge() !== null
}
