import { BrowserWindow } from "electron";
import path from "node:path";
import { getSidecarManager } from "./sidecars/manager";

let settingsWindow: BrowserWindow | null = null;

/**
 * Opens (or focuses) the single DeepTutor settings window and loads the application's settings page.
 *
 * If a settings window already exists and is not destroyed, it is focused. If the frontend port cannot be obtained, no window is opened. The function manages a single BrowserWindow instance and clears its reference when the window is closed.
 */
export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const manager = getSidecarManager();
  const frontendPort = manager?.getFrontendPort() ?? 0;
  if (frontendPort === 0) return;

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 640,
    title: "DeepTutor Settings",
    backgroundColor: "#0b0d12",
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void settingsWindow.loadURL(`http://127.0.0.1:${frontendPort}/electron-settings`);

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}
