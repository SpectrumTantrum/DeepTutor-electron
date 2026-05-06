import { ipcMain } from "electron";
import { getLogger } from "../sidecars/logger";
import { type SidecarManager } from "../sidecars/manager";
import {
  hasSecret,
  listSecretKeys,
  loadSettings,
  saveSettings,
  setSecret,
  type Settings,
} from "./store";

const log = getLogger("main");

/**
 * Registers IPC handlers for settings retrieval and saving, secret management, and requesting a sidecar restart.
 *
 * @param manager - Sidecar manager used to perform the shutdown when a restart is requested
 */
export function registerSettingsIpc(manager: SidecarManager): void {
  ipcMain.handle("settings:get", () => {
    const settings = loadSettings();
    const secretKeys = listSecretKeys();
    const secretStatus: Record<string, boolean> = {};
    for (const key of secretKeys) secretStatus[key] = hasSecret(key);
    return { settings, secretStatus, secretKeys };
  });

  ipcMain.handle("settings:save", (_event, partial: Partial<Settings>) => {
    return saveSettings(partial);
  });

  ipcMain.handle("secrets:set", (_event, key: string, value: string) => {
    if (typeof key !== "string" || typeof value !== "string") {
      throw new Error("secrets:set expects (key:string, value:string)");
    }
    setSecret(key, value);
    return { ok: true };
  });

  ipcMain.handle("secrets:has", (_event, key: string) => hasSecret(key));

  ipcMain.handle("sidecar:restart", async () => {
    log.info("settings change requested sidecar restart");
    await manager.shutdown();
    return { ok: true, hint: "relaunch_required" };
  });
}
