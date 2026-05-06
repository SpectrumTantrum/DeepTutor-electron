import { app, dialog } from "electron";
import { getLogger } from "./sidecars/logger";
import { loadSettings } from "./settings/store";

const log = getLogger("updater");

interface ElectronUpdater {
  autoUpdater: {
    logger: unknown;
    autoDownload: boolean;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    checkForUpdates: () => Promise<unknown>;
    downloadUpdate: () => Promise<unknown>;
    quitAndInstall: () => void;
  };
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    log.info("auto-update disabled in dev");
    return;
  }
  const settings = loadSettings();
  if (!settings.AUTO_UPDATE_ENABLED) {
    log.info("auto-update disabled by user setting");
    return;
  }

  let updater: ElectronUpdater;
  try {
    updater = require("electron-updater") as ElectronUpdater;
  } catch (err) {
    log.warn({ err: String(err) }, "electron-updater not installed; skipping");
    return;
  }

  const { autoUpdater } = updater;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", (info) => {
    log.info({ info }, "update available");
  });
  autoUpdater.on("update-not-available", () => {
    log.info("update not available");
  });
  autoUpdater.on("error", (err) => {
    log.error({ err: String(err) }, "auto-updater error");
  });
  autoUpdater.on("update-downloaded", () => {
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update Ready",
        message: "A new version of DeepTutor has been downloaded.",
        detail: "Restart the application to apply the update.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    log.warn({ err: String(err) }, "initial update check failed");
  });
}
