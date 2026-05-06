import { contextBridge, ipcRenderer } from "electron";

export interface DeepTutorBridge {
  isElectron: true;
  getSettings: () => Promise<{
    settings: Record<string, unknown>;
    secretStatus: Record<string, boolean>;
    secretKeys: readonly string[];
  }>;
  saveSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>;
  setSecret: (key: string, value: string) => Promise<{ ok: true }>;
  hasSecret: (key: string) => Promise<boolean>;
  restartSidecar: () => Promise<{ ok: boolean; hint?: string }>;
  uploadDroppedPaths: (
    paths: string[],
  ) => Promise<{ path: string; ok: boolean; response?: unknown; error?: string }[]>;
}

const bridge: DeepTutorBridge = {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (partial) => ipcRenderer.invoke("settings:save", partial),
  setSecret: (key, value) => ipcRenderer.invoke("secrets:set", key, value),
  hasSecret: (key) => ipcRenderer.invoke("secrets:has", key),
  restartSidecar: () => ipcRenderer.invoke("sidecar:restart"),
  uploadDroppedPaths: (paths) => ipcRenderer.invoke("files:upload", paths),
};

contextBridge.exposeInMainWorld("deeptutor", bridge);
