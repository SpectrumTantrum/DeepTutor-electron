import { contextBridge, ipcRenderer } from "electron";

export interface SplashBridge {
  onStatus: (cb: (stage: string) => void) => void;
  onError: (cb: (info: { message: string; detail: string }) => void) => void;
  showLogs: () => void;
  retry: () => void;
  quit: () => void;
}

const bridge: SplashBridge = {
  onStatus: (cb) => {
    ipcRenderer.on("splash:status", (_e, stage: string) => cb(stage));
  },
  onError: (cb) => {
    ipcRenderer.on(
      "splash:error",
      (_e, info: { message: string; detail: string }) => cb(info),
    );
  },
  showLogs: () => ipcRenderer.send("splash:show-logs"),
  retry: () => ipcRenderer.send("splash:retry"),
  quit: () => ipcRenderer.send("splash:quit"),
};

contextBridge.exposeInMainWorld("deeptutorSplash", bridge);
